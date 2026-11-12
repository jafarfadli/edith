"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { ApiError, fileUrl, getStructure } from "@/lib/api";
import { fontStore } from "@/lib/fonts";
import { loadDraft, saveDraft } from "@/lib/draft";
import { touchRecord } from "@/lib/library";
import { checkAlive, KEEP_ALIVE_MS, openEdit } from "@/lib/session";
import { noticeLifetime, noticeStore, type NoticeMsg } from "@/lib/notices";
import { isTextOp } from "@/lib/objects";
import { destroyPdf, loadPdf } from "@/lib/pdf";
import { dropLockedTextEdits, dropStaleTextEdits, resolveImports, restoreDraft } from "@/lib/restore";
import { errorMessage, t } from "@/lib/strings";
import { createDebounced } from "@/lib/autosave";
import { boxFonts } from "@/lib/textbox";
import { editorStore, useEditor, type EditorDoc } from "@/store/editor";
import { pdfStore } from "@/store/pdfs";
import { useSpaceHeld } from "@/store/view";
import { charsStore } from "@/store/chars";
import { hasPictureText, imageTextOf, isPrint, paragraphsOf, textStore } from "@/store/text";
import { BTN_PRIMARY } from "../ui/styles";
import { FormLayer } from "./forms/FormLayer";
import { Header } from "./Header";
import { Notice } from "./Notice";
import { PageList } from "./PageList";
import { ObjectContextMenu } from "./objects/ObjectContextMenu";
import { SelectionMiniBar } from "./objects/SelectionMiniBar";
import { PropertiesBar } from "./PropertiesBar";
import { Sidebar } from "./Sidebar";
import { Toolbar } from "./Toolbar";
import { ZoomPill } from "./ZoomPill";
import { useShortcuts } from "./useShortcuts";
import { useWheelZoom } from "./useWheelZoom";
import { runPageOcr } from "./text/ocrRun";

// The text tool's hooks live in the Konva overlay chunk (Konva must stay out of SSR), so install them when it loads.
const PageOverlay = dynamic(async () => {
  (await import("./text/install")).installTextTool();
  return import("./PageOverlay");
}, { ssr: false });
const TextEditor = dynamic(() => import("./text/TextEditor").then((m) => m.TextEditor), { ssr: false });
const CropOverlay = dynamic(() => import("./pages/CropOverlay"), { ssr: false });
const FindBar = dynamic(() => import("./find/FindBar").then((m) => m.FindBar), { ssr: false });
const OcrButton = dynamic(() => import("./text/OcrButton").then((m) => m.OcrButton), { ssr: false });


/** `editId`: the edit (the id of the document at its upload, the address /edit/{id}); the server's document for it is
 *  `serverId`, which changes when the edit is put back on the server after it forgot the PDF (lib/session.ts). */
export function Editor({ docId: editId, initialName }: { docId: string; initialName: string }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [notice, setNotice] = useState<NoticeMsg | null>(null);
  const info = useEditor((s) => s.info);
  const tool = useEditor((s) => s.tool);
  const space = useSpaceHeld();
  const initialDoc = useRef<EditorDoc | null>(null);
  const drag = useRef<{ x: number; y: number; l: number; t: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    initialDoc.current = null;
    (async () => {
      let st, docId: string;
      try {
        const opened = await openEdit(editId);
        st = opened.structure;
        docId = opened.serverId;
      } catch (e) {
        if (!cancelled) setFatal(e instanceof ApiError ? e.code : "generic");
        return;
      }
      if (cancelled) return;
      let draft = restoreDraft(loadDraft(editId), docId, st.page_count);
      // Text edits from before a segmentation change name other paragraphs now: drop them (with a notice below).
      const stale = draft ? dropStaleTextEdits(draft) : null;
      if (stale) draft = stale.doc;
      // Pages of imported PDFs need those documents' page sizes; imports that expired lose their pages.
      let resolved;
      try {
        resolved = draft?.imports?.length ? await resolveImports(draft, (id) => getStructure(id)) : null;
      } catch (e) {
        // Not "gone": keep the stored draft untouched (no init, so nothing autosaves over it).
        if (!cancelled) setFatal(e instanceof ApiError ? e.code : "network");
        return;
      }
      if (cancelled) return;
      if (resolved) draft = resolved.doc;
      editorStore.getState().init({ docId, editId, fileName: initialName, pages: st.pages, fields: st.fields, imports: resolved?.imports, importFields: resolved?.fields }, draft);
      initialDoc.current = editorStore.getState().doc;
      if (resolved?.missing) setNotice({ kind: "error", text: t.pages.importGone });
      else if (stale?.dropped) setNotice({ kind: "error", text: t.editor.textEditsDropped });
      else if (draft) setNotice({ kind: "info", text: t.editor.restored });
      // Original paragraphs + fonts, in the background. Text that is a picture (a scanned form, a letterhead image under
      // invisible text) is said once it is known, unless a notice that matters more is showing.
      void textStore.getState().load(docId).then(() => {
        if (cancelled || textStore.getState().docId !== docId) return;
        // A draft's edits of text that turned out to be a picture (M5c): the export refuses them. Dropped from the
        // document and its history alike (no undo step brings them back); the autosave then stores the draft without.
        const pages = textStore.getState().pages;
        const drop = (d: EditorDoc) => dropLockedTextEdits(d, pages).doc;
        const { dropped } = dropLockedTextEdits(editorStore.getState().doc, pages);
        if (dropped) {
          editorStore.setState((s) => ({ doc: drop(s.doc), past: s.past.map(drop), future: s.future.map(drop), selected: [], selection: null }));
          setNotice({ kind: "error", text: t.editor.lockedEditsDropped });
        } else if (hasPictureText()) {
          // A page with a picture of print: offer to read the first one (OCR, M5d). Invisible text over its picture only:
          // the first page with some says whether it can be edited as its picture (GET .../hidden-text), or why not.
          const srcs = editorStore.getState().doc.pages.map((p) => p.src);
          const first = srcs.find((src) => imageTextOf(src).some(isPrint));
          const say = (msg: NoticeMsg) => setNotice((n) => (n?.kind === "error" ? n : msg));
          if (first && "doc" in first) {
            say({ kind: "info", text: t.editor.pictureTextOcr, action: { label: t.ocr.run, run: () => { void runPageOcr(first.doc, first.index); } } });
            return;
          }
          const hiddenSrc = srcs.find((src) => paragraphsOf(src).some((p) => p.lock === "hidden"));
          if (!hiddenSrc || !("doc" in hiddenSrc)) return;
          void textStore.getState().loadHidden(hiddenSrc.doc, hiddenSrc.index).then((st) => {
            if (cancelled || textStore.getState().docId !== docId) return;
            const editable = new Set(st.paragraphs.map((p) => p.replaces));
            const all = paragraphsOf(hiddenSrc).filter((p) => p.lock === "hidden").every((p) => editable.has(p.id));
            say({ kind: "info", text: all ? t.editor.pictureTextHidden : t.editor.pictureText });
          });
        }
      });
      for (const id of Object.keys(resolved?.imports ?? {})) void textStore.getState().loadImport(id);
      charsStore.getState().reset();
      // Preload fonts of restored text boxes (in parallel with the PDF; TextNode also loads on demand).
      const texts = Object.values(editorStore.getState().doc.objects).filter(isTextOp);
      void Promise.all(texts.flatMap((o) => boxFonts(o.box)).map((f) => fontStore.load(f))).catch((e) => console.warn("font preload failed", e));
      try {
        const loaded = await loadPdf(fileUrl(docId));
        if (cancelled) { destroyPdf(loaded); return; }
        pdfStore.getState().put(docId, loaded); // pages render from the store (imported PDFs load there on demand)
        setPdf(loaded);
      } catch {
        if (!cancelled) setFatal("network");
      }
    })();
    return () => {
      cancelled = true;
      pdfStore.getState().reset(); // destroys the main PDF and every imported one
      setPdf(null);
      setFatal(null);
    };
  }, [editId, initialName]);

  // Autosave the undoable document (debounced), but not the document produced by init.
  useEffect(() => {
    const saver = createDebounced<{ id: string; doc: EditorDoc }>((v) => { saveDraft(v.id, v.doc); touchRecord(v.id); }, 500);
    let dirty = false;
    const unsub = editorStore.subscribe((s, prev) => {
      if (s.doc === prev.doc || !s.info || !initialDoc.current) return;
      if (!dirty && s.doc === initialDoc.current) return;
      dirty = true;
      saver.push({ id: s.info.editId, doc: s.doc });
    });
    const onHide = () => saver.flush();
    window.addEventListener("pagehide", onHide);
    return () => { window.removeEventListener("pagehide", onHide); unsub(); saver.flush(); };
  }, []);

  // The server drops a document an hour after its last use. An open editor keeps it (and when it was dropped anyway, e.g.
  // the laptop slept, the edit is put back and the page reopens it: the draft is saved, so nothing is lost).
  const liveDoc = useEditor((s) => s.info?.docId);
  useEffect(() => {
    if (!liveDoc) return;
    let last = Date.now();
    const check = async () => {
      last = Date.now();
      if ((await checkAlive(editId, liveDoc)) === "moved") window.location.reload();
    };
    const timer = setInterval(() => void check(), KEEP_ALIVE_MS);
    const onVisible = () => { if (document.visibilityState === "visible" && Date.now() - last > 30_000) void check(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [editId, liveDoc]);

  // Notices raised by store actions (e.g. a text commit that deleted marks).
  useEffect(() => noticeStore.subscribe((s, prev) => { if (s.notice && s.notice !== prev.notice) setNotice(s.notice); }), []);

  // Info notices go away by themselves (later when they carry a button); errors stay until closed.
  useEffect(() => {
    const ms = notice ? noticeLifetime(notice) : null;
    if (ms === null) return;
    const timer = setTimeout(() => setNotice((n) => (n === notice ? null : n)), ms);
    return () => clearTimeout(timer);
  }, [notice]);

  useShortcuts();
  useWheelZoom("page-scroller");

  if (fatal) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-canvas px-4 text-center">
        <p role="alert" className="max-w-md text-base text-ink">{errorMessage(fatal)}</p>
        <Link href="/" className={BTN_PRIMARY}>{t.upload.choose}</Link>
      </main>
    );
  }

  return (
    <div className="flex h-dvh flex-col bg-panel">
      <Header onNotice={setNotice}><Toolbar onNotice={setNotice} /></Header>
      <div className="flex min-h-0 flex-1">
        {pdf ? <Sidebar /> : <aside className="w-52 shrink-0 border-r border-line bg-panel" />}
        <div className="relative min-w-0 flex-1">
          <PropertiesBar />
          <main
            className="absolute inset-0 overflow-auto bg-canvas"
            id="page-scroller"
            style={{ cursor: tool === "pan" || space ? "grab" : undefined }}
            // The middle button pans too (and must not start the browser's auto-scroll).
            onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
            onPointerDown={(e) => {
              if (!(tool === "pan" || space || e.button === 1)) return;
              const el = e.currentTarget;
              drag.current = { x: e.clientX, y: e.clientY, l: el.scrollLeft, t: el.scrollTop };
            }}
            onPointerMove={(e) => {
              if (!drag.current || !(e.buttons & 5)) return; // left or middle button
              const el = e.currentTarget;
              el.scrollLeft = drag.current.l - (e.clientX - drag.current.x);
              el.scrollTop = drag.current.t - (e.clientY - drag.current.y);
            }}
            onPointerUp={() => { drag.current = null; }}
          >
            {info && pdf ? <PageList overlay={(a) => <><PageOverlay {...a} /><FormLayer {...a} /><TextEditor {...a} /><SelectionMiniBar {...a} /><OcrButton {...a} /><CropOverlay {...a} /></>} /> : <p className="p-8 text-muted" role="status">{t.upload.processing}</p>}
          </main>
          <ZoomPill />
          {/* Over the canvas (centred on it, above the zoom pill), not on the window. */}
          {notice && <Notice kind={notice.kind} action={notice.action} onClose={() => setNotice(null)}>{notice.text}</Notice>}
        </div>
      </div>
      <FindBar />
      <ObjectContextMenu />
    </div>
  );
}
