"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { ApiError, fileUrl, getStructure } from "@/lib/api";
import { toPage } from "@/lib/coords";
import { fontStore } from "@/lib/fonts";
import { loadDraft, saveDraft } from "@/lib/draft";
import { noticeStore, type NoticeMsg } from "@/lib/notices";
import { isTextOp, moveOp } from "@/lib/objects";
import { destroyPdf, loadPdf } from "@/lib/pdf";
import { resolveImports, restoreDraft } from "@/lib/restore";
import { errorMessage, t } from "@/lib/strings";
import { createDebounced } from "@/lib/autosave";
import { boxFonts } from "@/lib/textbox";
import { editorStore, pageGeom, useEditor, type EditorDoc } from "@/store/editor";
import { pdfStore } from "@/store/pdfs";
import { charsStore } from "@/store/chars";
import { textStore } from "@/store/text";
import { FormLayer } from "./forms/FormLayer";
import { Header } from "./Header";
import { Notice } from "./Notice";
import { PageList } from "./PageList";
import { SelectionMiniBar } from "./objects/SelectionMiniBar";
import { PropertiesBar } from "./PropertiesBar";
import { Sidebar } from "./Sidebar";
import { Toolbar } from "./Toolbar";
import { ZoomPill } from "./ZoomPill";
import { useShortcuts } from "./useShortcuts";

// The text tool's hooks live in the Konva overlay chunk (Konva must stay out of SSR), so install them when it loads.
const PageOverlay = dynamic(async () => {
  (await import("./text/install")).installTextTool();
  return import("./PageOverlay");
}, { ssr: false });
const TextEditor = dynamic(() => import("./text/TextEditor").then((m) => m.TextEditor), { ssr: false });
const CropOverlay = dynamic(() => import("./pages/CropOverlay"), { ssr: false });
const FindBar = dynamic(() => import("./find/FindBar").then((m) => m.FindBar), { ssr: false });

const INFO_NOTICE_MS = 5000;

export function Editor({ docId, initialName }: { docId: string; initialName: string }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [notice, setNotice] = useState<NoticeMsg | null>(null);
  const info = useEditor((s) => s.info);
  const tool = useEditor((s) => s.tool);
  const initialDoc = useRef<EditorDoc | null>(null);
  const drag = useRef<{ x: number; y: number; l: number; t: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    initialDoc.current = null;
    (async () => {
      let st;
      try {
        st = await getStructure(docId);
      } catch (e) {
        if (!cancelled) setFatal(e instanceof ApiError ? e.code : "generic");
        return;
      }
      if (cancelled) return;
      let draft = restoreDraft(loadDraft(st.sha256), docId, st.page_count);
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
      editorStore.getState().init({ docId, sha256: st.sha256, fileName: initialName, pages: st.pages, fields: st.fields, imports: resolved?.imports, importFields: resolved?.fields }, draft);
      initialDoc.current = editorStore.getState().doc;
      if (resolved?.missing) setNotice({ kind: "error", text: t.pages.importGone });
      else if (draft) setNotice({ kind: "info", text: t.editor.restored });
      void textStore.getState().load(docId); // original paragraphs + fonts, in the background
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
  }, [docId, initialName]);

  // Autosave the undoable document (debounced), but not the document produced by init.
  useEffect(() => {
    const saver = createDebounced<{ sha: string; doc: EditorDoc }>((v) => saveDraft(v.sha, v.doc), 500);
    let dirty = false;
    const unsub = editorStore.subscribe((s, prev) => {
      if (s.doc === prev.doc || !s.info || !initialDoc.current) return;
      if (!dirty && s.doc === initialDoc.current) return;
      dirty = true;
      saver.push({ sha: s.info.sha256, doc: s.doc });
    });
    const onHide = () => saver.flush();
    window.addEventListener("pagehide", onHide);
    return () => { window.removeEventListener("pagehide", onHide); unsub(); saver.flush(); };
  }, []);

  // Notices raised by store actions (e.g. a text commit that deleted marks).
  useEffect(() => noticeStore.subscribe((s, prev) => { if (s.notice && s.notice !== prev.notice) setNotice(s.notice); }), []);

  // Info notices go away by themselves; errors stay until closed.
  useEffect(() => {
    if (notice?.kind !== "info") return;
    const timer = setTimeout(() => setNotice((n) => (n === notice ? null : n)), INFO_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  const nudge = useCallback((e: KeyboardEvent) => {
    const dirs: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const d = dirs[e.key];
    const st = editorStore.getState();
    if (!d || !st.selection || !st.info) return false;
    const op = st.doc.objects[st.selection];
    const entry = st.doc.pages.find((p) => p.pageKey === op?.pageKey);
    if (!op || !entry) return false;
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    const g = pageGeom(entry, st.info);
    const [x0, y0] = toPage([0, 0], g, 1);
    const [x1, y1] = toPage([d[0] * step, d[1] * step], g, 1);
    st.updateObject(op.id, moveOp(op, x1 - x0, y1 - y0), { coalesce: `nudge:${op.id}` }); // held arrow keys: one undo step
    return true;
  }, []);
  useShortcuts(nudge);

  if (fatal) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
        <p role="alert" className="max-w-md text-lg">{errorMessage(fatal)}</p>
        <Link href="/" className="rounded-lg bg-accent px-4 py-2 text-accent-ink">{t.upload.choose}</Link>
      </main>
    );
  }

  return (
    <div className="flex h-dvh flex-col">
      <Header onNotice={setNotice} />
      <Toolbar onNotice={setNotice} />
      <PropertiesBar />
      <div className="flex min-h-0 flex-1">
        {pdf ? <Sidebar /> : <aside className="w-48 shrink-0 border-r border-line bg-surface" />}
        <main
          className="relative min-w-0 flex-1 overflow-auto bg-bg"
          id="page-scroller"
          style={{ cursor: tool === "pan" ? "grab" : undefined }}
          onPointerDown={(e) => {
            if (tool !== "pan") return;
            const el = e.currentTarget;
            drag.current = { x: e.clientX, y: e.clientY, l: el.scrollLeft, t: el.scrollTop };
          }}
          onPointerMove={(e) => {
            if (!drag.current || e.buttons !== 1) return;
            const el = e.currentTarget;
            el.scrollLeft = drag.current.l - (e.clientX - drag.current.x);
            el.scrollTop = drag.current.t - (e.clientY - drag.current.y);
          }}
          onPointerUp={() => { drag.current = null; }}
        >
          {info && pdf ? <PageList overlay={(a) => <><PageOverlay {...a} /><FormLayer {...a} /><TextEditor {...a} /><SelectionMiniBar {...a} /><CropOverlay {...a} /></>} /> : <p className="p-8 text-muted" role="status">{t.upload.processing}</p>}
        </main>
      </div>
      <FindBar />
      <ZoomPill />
      {notice && <Notice kind={notice.kind} action={notice.action} onClose={() => setNotice(null)}>{notice.text}</Notice>}
    </div>
  );
}
