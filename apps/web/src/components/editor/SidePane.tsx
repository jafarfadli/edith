"use client";

import type { BundledFont, ContentOp, FontRef } from "@edith/ops";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { getStructure, type Paragraph } from "@/lib/api";
import type { Pt } from "@/lib/coords";
import { fontId, isOriginal } from "@/lib/fonts";
import { newId } from "@/lib/id";
import { noticeStore } from "@/lib/notices";
import { openEdit } from "@/lib/session";
import { t } from "@/lib/strings";
import { subscribeTabs, tabsServerSnapshot, tabsSnapshot } from "@/lib/tabs";
import { editorStore } from "@/store/editor";
import { usePdf } from "@/store/pdfs";
import { paragraphsOf, textStore } from "@/store/text";
import { CloseIcon, SpinnerIcon } from "../brand/icons";
import { BTN_ICON } from "../ui/styles";
import { setClipboard, standIn } from "./objects/clipboard";
import { pagePoint, pageUnder } from "./objects/useObjectDrag";
import { currentPage } from "./placement";
import { paragraphStartBox } from "./text/textEdit";

/** The other document shown beside the one edited (an open tab's edit id), or none. */
export const sideStore = createStore<{ editId: string | null; show(id: string | null): void }>()((set) => ({
  editId: null,
  show: (editId) => set({ editId }),
}));

const MIME = "application/x-edith-paragraph";
/** What a paragraph dragged out of the side pane carries. */
interface Carried { doc: string; index: number; id: string; grab: Pt }

/** A paragraph of the other document as a text box of this one, its fonts swapped for their stand-ins (fonts embedded in
 *  another PDF cannot be used here), on `pageKey` with its top-left at `at` (or where it was on its page). */
async function paragraphOp(p: Paragraph, pageKey: string, at?: Pt): Promise<ContentOp> {
  const box = await paragraphStartBox(p);
  const table = textStore.getState().fonts;
  const subs: Record<string, BundledFont> = {};
  for (const f of box.paragraphs.flat().map((r) => r.font as FontRef)) if (isOriginal(f) && table[fontId(f)]) subs[fontId(f)] = table[fontId(f)].substitute;
  const plain = await standIn(box, subs);
  const rect = at ? { ...plain.rect, x: at[0], y: at[1] } : plain.rect;
  return { id: newId(), type: "text.add", pageKey, box: { ...plain, rect } } as ContentOp;
}

function findParagraph(doc: string, index: number, id: string): Paragraph | undefined {
  return paragraphsOf({ doc, index }).find((p) => p.id === id);
}

/** "Berdampingan": another open document beside the edited one, read only. Its paragraphs are dragged onto a page of
 *  this one (or clicked: copied, for Ctrl+V), and any of its pages inserted after the page in view, so text and pages
 *  move from one PDF to another without leaving the editor. */
export function SidePane() {
  const editId = useStore(sideStore, (s) => s.editId);
  const tabs = useSyncExternalStore(subscribeTabs, tabsSnapshot, tabsServerSnapshot);
  const here = editorStore.getState().info?.editId;
  const others = tabs.filter((x) => x.id !== here);
  const [serverId, setServerId] = useState<{ edit: string; doc: string } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const pdf = usePdf(serverId?.edit === editId ? serverId.doc : null);

  useEffect(() => {
    if (!editId) return;
    let live = true;
    openEdit(editId).then(
      (o) => { if (!live) return; setServerId({ edit: editId, doc: o.serverId }); void textStore.getState().loadImport(o.serverId); },
      () => { if (live) setFailed(editId); },
    );
    return () => { live = false; };
  }, [editId]);

  // A paragraph dropped on a page of the edited document lands there as a text box.
  useEffect(() => {
    const over = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes(MIME) && pageUnder(e.clientX, e.clientY)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }
    };
    const drop = (e: DragEvent) => {
      const raw = e.dataTransfer?.getData(MIME);
      const page = raw ? pageUnder(e.clientX, e.clientY) : null;
      if (!raw || !page) return;
      e.preventDefault();
      const c = JSON.parse(raw) as Carried;
      const p = findParagraph(c.doc, c.index, c.id);
      const at = pagePoint(page.key, [e.clientX, e.clientY]);
      if (!p || !at) return;
      void paragraphOp(p, page.key, [at[0] - c.grab[0], at[1] - c.grab[1]]).then((op) => {
        const s = editorStore.getState();
        s.putObjects([op]);
        s.setTool("select");
        s.select(op.id);
      }).catch(() => noticeStore.getState().show({ kind: "error", text: t.side.failed }));
    };
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => { window.removeEventListener("dragover", over); window.removeEventListener("drop", drop); };
  }, []);

  if (!editId) return null;
  const tab = others.find((x) => x.id === editId);
  const ready = pdf && serverId?.edit === editId;
  return (
    <aside aria-label={t.side.title} data-testid="side-pane"
      className="hidden w-[clamp(18rem,30vw,28rem)] shrink-0 flex-col border-l border-line bg-panel lg:flex">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-2">
        <select aria-label={t.side.which} value={editId} onChange={(e) => sideStore.getState().show(e.target.value)}
          className="h-8 min-w-0 flex-1 truncate rounded-md border border-line bg-base px-2 text-xs text-ink">
          {others.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          {!tab && <option value={editId}>{editId}</option>}
        </select>
        <button type="button" className={BTN_ICON} aria-label={t.side.close} onClick={() => sideStore.getState().show(null)}><CloseIcon size={14} /></button>
      </div>
      <p className="shrink-0 border-b border-line px-3 py-2 text-2xs leading-relaxed text-muted">{t.side.hint}</p>
      <div className="min-h-0 flex-1 overflow-y-auto bg-canvas p-3" data-testid="side-pages">
        {failed === editId ? <p className="text-xs text-danger-text">{t.side.gone}</p>
          : !ready ? <p className="flex items-center gap-2 text-xs text-muted"><SpinnerIcon size={14} className="animate-spin" aria-hidden />{t.upload.processing}</p>
            : <SidePages pdf={pdf} doc={serverId.doc} />}
      </div>
    </aside>
  );
}

function SidePages({ pdf, doc }: { pdf: PDFDocumentProxy; doc: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={box} className="flex flex-col gap-4">
      {width > 0 && Array.from({ length: pdf.numPages }, (_, i) => <SidePage key={i} pdf={pdf} doc={doc} index={i} width={width} />)}
    </div>
  );
}

function SidePage({ pdf, doc, index, width }: { pdf: PDFDocumentProxy; doc: string; index: number; width: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ w: number; h: number; scale: number; turned: boolean } | null>(null);
  const paragraphs = useStore(textStore, (s) => paragraphsOf({ doc, index }, s.pages));

  useEffect(() => {
    let live = true;
    let task: ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]> | null = null;
    (async () => {
      const page = await pdf.getPage(index + 1);
      const base = page.getViewport({ scale: 1 });
      const scale = width / base.width;
      const dpr = window.devicePixelRatio || 1;
      const vp = page.getViewport({ scale: scale * dpr });
      const c = canvas.current;
      if (!live || !c) return;
      c.width = Math.floor(vp.width);
      c.height = Math.floor(vp.height);
      setSize({ w: width, h: base.height * scale, scale, turned: page.rotate % 360 !== 0 });
      task = page.render({ canvas: c, viewport: vp });
      await task.promise.catch(() => undefined);
    })();
    return () => { live = false; task?.cancel(); };
  }, [pdf, index, width]);

  async function insert() {
    const s = editorStore.getState();
    const at = currentPage();
    try {
      if (!s.info?.imports?.[doc]) {
        const st = await getStructure(doc);
        s.addImport(doc, st.pages, st.fields);
      }
      const keys = s.insertImportAfter(at?.entry.pageKey ?? null, doc, [index]);
      if (keys.length) noticeStore.getState().show({ kind: "info", text: t.side.inserted(index + 1) });
    } catch {
      noticeStore.getState().show({ kind: "error", text: t.side.failed });
    }
  }

  async function copy(p: Paragraph) {
    const at = currentPage();
    try {
      setClipboard([await paragraphOp(p, at?.entry.pageKey ?? "")]);
      noticeStore.getState().show({ kind: "info", text: t.side.copied });
    } catch {
      noticeStore.getState().show({ kind: "error", text: t.side.failed });
    }
  }

  return (
    <figure className="flex flex-col gap-1.5" data-testid="side-page">
      <div className="relative overflow-hidden bg-paper shadow-page" style={{ width, height: size?.h ?? width * 1.414 }}>
        <canvas ref={canvas} className="absolute inset-0 h-full w-full" />
        {size && !size.turned && paragraphs.filter((p) => p.editable).map((p) => (
          <button key={p.id} type="button" draggable data-testid="side-paragraph" title={t.side.paragraphTip}
            aria-label={`${t.side.paragraph}: ${p.runs.map((r) => r.text).join("").slice(0, 60)}`}
            onClick={() => void copy(p)}
            onDragStart={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              const grab: Pt = [(e.clientX - r.left) / size.scale, (e.clientY - r.top) / size.scale];
              e.dataTransfer.setData(MIME, JSON.stringify({ doc, index, id: p.id, grab } satisfies Carried));
              e.dataTransfer.effectAllowed = "copy";
            }}
            className="absolute cursor-grab rounded-[2px] outline-dashed outline-1 outline-accent/30 ring-accent/0 transition-[box-shadow,background-color] hover:bg-accent/10 hover:ring-2 hover:ring-accent/70 focus-visible:ring-2 focus-visible:ring-accent active:cursor-grabbing"
            style={{ left: p.rect.x * size.scale - 2, top: p.rect.y * size.scale - 2, width: p.rect.w * size.scale + 4, height: p.rect.h * size.scale + 4 }} />
        ))}
      </div>
      <figcaption className="flex items-center justify-between gap-2 text-2xs text-muted">
        <span>{t.pages.pageN(index + 1)}</span>
        <button type="button" onClick={() => void insert()} data-testid="side-insert"
          className="rounded-md px-2 py-1 text-2xs font-medium text-ink ring-1 ring-inset ring-line hover:bg-hover">{t.side.insert}</button>
      </figcaption>
    </figure>
  );
}
