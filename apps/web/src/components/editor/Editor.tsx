"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { ApiError, fileUrl, getStructure } from "@/lib/api";
import { loadDraft, saveDraft } from "@/lib/draft";
import { destroyPdf, loadPdf } from "@/lib/pdf";
import { restoreDraft } from "@/lib/restore";
import { errorMessage, t } from "@/lib/strings";
import { createDebounced } from "@/lib/autosave";
import { editorStore, useEditor, type EditorDoc } from "@/store/editor";
import { Header } from "./Header";
import { Notice } from "./Notice";
import { PageList } from "./PageList";
import { Sidebar } from "./Sidebar";
import { ZoomPill } from "./ZoomPill";
import { useShortcuts } from "./useShortcuts";

export function Editor({ docId, initialName }: { docId: string; initialName: string }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const info = useEditor((s) => s.info);
  const tool = useEditor((s) => s.tool);
  const initialDoc = useRef<EditorDoc | null>(null);
  const drag = useRef<{ x: number; y: number; l: number; t: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let doc: PDFDocumentProxy | null = null;
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
      const draft = restoreDraft(loadDraft(st.sha256), docId, st.page_count);
      editorStore.getState().init({ docId, sha256: st.sha256, fileName: initialName, pages: st.pages }, draft);
      initialDoc.current = editorStore.getState().doc;
      if (draft) setNotice({ kind: "info", text: t.editor.restored });
      try {
        const loaded = await loadPdf(fileUrl(docId));
        if (cancelled) { destroyPdf(loaded); return; }
        doc = loaded;
        setPdf(loaded);
      } catch {
        if (!cancelled) setFatal("network");
      }
    })();
    return () => {
      cancelled = true;
      if (doc) destroyPdf(doc);
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

  useShortcuts();

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
      <div className="h-12 shrink-0 border-b border-line bg-surface" data-slot="toolbar" />
      <div className="flex min-h-0 flex-1">
        {pdf ? <Sidebar pdf={pdf} /> : <aside className="w-48 shrink-0 border-r border-line bg-surface" />}
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
          {info && pdf ? <PageList pdf={pdf} /> : <p className="p-8 text-muted" role="status">{t.upload.processing}</p>}
        </main>
      </div>
      <ZoomPill />
      {notice && <Notice kind={notice.kind} onClose={() => setNotice(null)}>{notice.text}</Notice>}
    </div>
  );
}
