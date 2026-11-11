"use client";

import { useEffect, useRef, useState } from "react";
import type Konva from "konva";
import { Label, Rect, Tag, Text, Transformer } from "react-konva";
import { useStore } from "zustand";
import type { Rect as Box, TextBox, TextEdit } from "@edith/ops";
import type { OcrParagraph, Paragraph } from "@/lib/api";
import { areaKey, coverRects, isLowConfidence, ocrBadge, ocrEditsOn, replacedIds, unedited, type OcrCover } from "@/lib/ocr";
import { noticeStore } from "@/lib/notices";
import { maskRects } from "@/lib/paragraphs";
import { srcKey } from "@/lib/sources";
import { t } from "@/lib/strings";
import { editorStore, useEditor } from "@/store/editor";
import { hiddenParagraphsOf, hiddenRetryIn, imagesOf, imageTextOf, isPrint, paragraphsOf, pictureParagraphsOf, textStore, useText } from "@/store/text";
import { contextMenuStore } from "../objects/layering";
import { runPageOcr } from "./ocrRun";
import { materializeParagraph, paragraphPreview, paragraphStartBox, resizedParagraph, startOcrEdit, startParagraphEdit, textEditStore } from "./textEdit";
import { TextNode } from "./TextNode";
import { CANVAS } from "@/lib/theme";

const OUTLINE = CANVAS.accent;
/** Screen pixels the pointer must move before a press on the selected paragraph becomes a drag. */
const DRAG_DISTANCE = 3;

function setCursor(e: Konva.KonvaEventObject<unknown>, cursor: string) {
  const c = e.target.getStage()?.container();
  if (c) c.style.cursor = cursor;
}

/** Text that can't be edited (a locked paragraph, an image of print): its key and the notice that says why, with OCR
 *  to offer: of the page's pictures of print (`page`) or of the `picture` under it. */
interface Locked { key: string; rect: Box; why: string; page?: boolean; picture?: Box }

/** Badge text size (pt) over an OCR paragraph. */
const BADGE_SIZE = 8;
const BADGE_PAD = 2.5;

/** Locked targets (source page `srcKey` / target key) explained under the text tool once already: there a click still
 *  adds a text box (the way to replace such text is a whiteout and new text over it), so the notice is not repeated on
 *  every click. Keyed by source page, so another document's page 1 is explained again. */
const explained = new Set<string>();

/** Under the page's objects: white covers over the lines edited paragraphs replace (the bake redacts them) and, for
 *  the select and text tools, hover/select/drag/resize targets over the paragraphs not edited yet. Text that can't be
 *  edited (a locked paragraph, an image of print: M5c) gets a target too, which says why when clicked. Paragraphs OCR
 *  read (M5d) show with a dashed accent outline (amber when unsure) and a "hasil OCR" badge on hover or selection; an
 *  edited one is covered in its picture's background colour, as the export paints it (from its op: no OCR needed). */
export function ParagraphLayer({ pageKey }: { pageKey: string }) {
  const entry = useEditor((s) => s.doc.pages.find((p) => p.pageKey === pageKey));
  const order = useEditor((s) => s.doc.order);
  const objects = useEditor((s) => s.doc.objects);
  const tool = useEditor((s) => s.tool);
  const pages = useText((s) => s.pages);
  const imageText = useText((s) => s.imageText);
  const ocr = useText((s) => s.ocr);
  const hidden = useText((s) => s.hidden);
  const images = useText((s) => s.images);
  const editing = useStore(textEditStore, (s) => s.editing);
  const selected = useStore(textEditStore, (s) => (s.paragraph?.pageKey === pageKey ? s.paragraph.id : null));
  const [hover, setHover] = useState<string | null>(null);
  const nodes = useRef(new Map<string, Konva.Rect>());
  const trRef = useRef<Konva.Transformer>(null);
  // A handle being dragged: the paragraph's redrawn box (loaded when the drag starts) and the text laid out for the
  // frame at the pointer, drawn over a white cover until release (the page's own glyphs cannot be re-wrapped).
  const resizing = useRef<{ id: string; base: TextBox | null; cancelled: boolean } | null>(null);
  const [preview, setPreview] = useState<{ op: TextEdit; p: Paragraph } | null>(null);
  // Escape cancels the drag (captured: the shortcut that deselects does not see it).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !resizing.current || !trRef.current?.isTransforming()) return;
      e.stopPropagation();
      resizing.current.cancelled = true;
      trRef.current.stopTransform();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const paragraphs = entry ? paragraphsOf(entry.src, pages) : [];
  // Edited paragraph → its op's box (lines it keeps stay uncovered); undefined while its rich editor is open.
  const edits = new Map<string, TextBox | undefined>(order.map((id) => objects[id])
    .filter((op): op is TextEdit => op?.type === "text.edit" && op.pageKey === pageKey)
    .map((op) => [op.paragraphId, op.box]));
  if (editing?.kind === "text.edit" && editing.pageKey === pageKey && editing.paragraphId) edits.set(editing.paragraphId, undefined);
  const edited = new Set(edits.keys());
  // OCR edits of this page (and the one being typed): their covers, and the OCR paragraphs they replace.
  const ocrEdits: ({ id: string; paragraphId: string } & OcrCover)[] = ocrEditsOn(order.map((id) => objects[id]), pageKey);
  if (editing?.kind === "text.ocr_edit" && editing.pageKey === pageKey && editing.ocr && !ocrEdits.some((e) => e.id === editing.id)) {
    ocrEdits.push({ id: editing.id, paragraphId: editing.paragraphId!, ...editing.ocr });
  }
  // Paragraphs edited as a picture of text: hidden ones whose print was measured (their text known), and OCR's.
  const ocrShown = entry ? unedited(pictureParagraphsOf(entry.src, { ocr, hidden }), ocrEdits) : [];
  const src = entry && "doc" in entry.src ? entry.src : null;
  const hiddenState = src ? hidden[srcKey(src.doc, src.index)] : undefined;
  // Hidden paragraphs replaced: by a measured one, or by a rewrite already made (a restored draft's hgN edit: no
  // locked target over its cover, whatever the measurement says now).
  const replaced = replacedIds(entry ? hiddenParagraphsOf(entry.src, hidden) : [], ocrEdits);
  const hasHidden = paragraphs.some((p) => p.lock === "hidden");
  const interactive = tool === "select" || tool === "text";
  // The selected paragraph only keeps its handles while it is still an original one under the select tool.
  const active = selected && tool === "select" && !edited.has(selected) ? selected : null;

  useEffect(() => {
    const node = active ? nodes.current.get(active) : undefined;
    trRef.current?.nodes(node ? [node] : []);
    trRef.current?.getLayer()?.batchDraw();
  }, [active, pages]);

  // A page shown with hidden text asks once which of it can be edited as its picture (GET .../hidden-text); a failure
  // (the server busy measuring other pages) is asked again a few times, later each time.
  useEffect(() => {
    if (!src || !hasHidden) return;
    if (!hiddenState) { void textStore.getState().loadHidden(src.doc, src.index); return; }
    const wait = hiddenRetryIn(hiddenState);
    if (wait === null) return;
    const timer = setTimeout(() => { void textStore.getState().loadHidden(src.doc, src.index); }, wait);
    return () => clearTimeout(timer);
  }, [src, hasHidden, hiddenState]);

  // Images of print first, so a locked paragraph over one (invisible text over its picture) is the target hit. A picture
  // that only maybe holds text is no target: it may be a logo (its own button offers OCR). A hidden paragraph whose
  // print was measured is edited as an OCR one (it is in ocrShown), even once rewritten.
  // Hidden text whose print could not be measured: OCR of the picture under it is the way left (when it was asked).
  const pictureUnder = (r: Box): Box | undefined => {
    if (hiddenState?.status !== "ready" || !entry) return undefined;
    const c = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
    return imagesOf(entry.src, images).find((im) => c.x >= im.x && c.x <= im.x + im.w && c.y >= im.y && c.y <= im.y + im.h);
  };
  const locked: Locked[] = [
    ...(entry ? imageTextOf(entry.src, imageText) : []).filter(isPrint).map((r, i) => ({ key: `image-${i}`, rect: r, why: t.editor.imageTextOcr, page: true })),
    ...paragraphs.filter((p) => !p.editable && p.lock && !edited.has(p.id) && !replaced.has(p.id)).map((p) => {
      const picture = p.lock === "hidden" ? pictureUnder(p.rect) : undefined;
      return { key: `lock-${p.id}`, rect: p.rect, why: picture ? t.editor.hiddenOcr : t.editor.locked[p.lock!], picture };
    }),
  ];
  if (!paragraphs.length && !locked.length && !ocrShown.length && !ocrEdits.length) return null;

  const select = (p: Paragraph) => {
    editorStore.getState().select(null);
    textEditStore.getState().selectParagraph({ pageKey, id: p.id });
  };
  // An image of print explains itself with a way out: read it (OCR), unless that ran already; so does hidden text whose
  // print could not be measured (OCR of the picture under it).
  const explain = (l: Locked) => {
    const st = src ? textStore.getState().ocr[srcKey(src.doc, src.index)] : undefined;
    const offer = src && ((l.page && !st?.full) || (l.picture && !st?.areas?.includes(areaKey(l.picture))));
    noticeStore.getState().show({ kind: "info", text: l.why, ...(offer ? { action: { label: t.ocr.run, run: () => { void runPageOcr(src.doc, src.index, l.picture); } } } : {}) });
  };
  const selectOcr = (p: OcrParagraph) => {
    editorStore.getState().select(null);
    textEditStore.getState().selectParagraph({ pageKey, id: p.id });
  };
  // Right-click (select tool): the paragraph selected, its menu (Edit teks, Hapus teks) instead of the browser's.
  const openMenu = (e: Konva.KonvaEventObject<PointerEvent | MouseEvent>, p: Paragraph) => {
    if (tool !== "select" || textEditStore.getState().editing) return;
    e.cancelBubble = true;
    e.evt.preventDefault();
    select(p);
    contextMenuStore.getState().open({ x: e.evt.clientX, y: e.evt.clientY, paragraph: { pageKey, id: p.id } });
  };
  // Select tool: a press is a press on the empty page (it clears the selection: Delete must not remove an object the
  // user sees as deselected); a double-click explains. Text tool: the press still adds a text box (the way to replace
  // such text is a whiteout and new text over it) and explains once per target of a source page.
  const press = (l: Locked) => {
    if (tool === "select") {
      editorStore.getState().select(null);
      textEditStore.getState().selectParagraph(null);
      return;
    }
    const once = `${entry && "doc" in entry.src ? srcKey(entry.src.doc, entry.src.index) : pageKey}/${l.key}`;
    if (explained.has(once)) return;
    explained.add(once);
    explain(l);
  };

  return (
    <>
      {paragraphs.filter((p) => edited.has(p.id)).flatMap((p) => maskRects(p, edits.get(p.id)).map((r, i) => (
        <Rect key={`mask-${p.id}-${i}`} x={r.x} y={r.y} width={r.w} height={r.h} fill="#ffffff" listening={false} />
      )))}
      {ocrEdits.flatMap((e) => coverRects(e).map((r, i) => (
        <Rect key={`cover-${e.id}-${i}`} name="ocr-cover" x={r.x} y={r.y} width={r.w} height={r.h} fill={e.coverColor} listening={false} />
      )))}
      {preview && maskRects(preview.p).map((r, i) => (
        <Rect key={`resize-cover-${i}`} x={r.x} y={r.y} width={r.w} height={r.h} fill="#ffffff" listening={false} />
      ))}
      {preview && <TextNode op={preview.op} hidden={false} />}
      {locked.map((l) => (
        <Rect
          key={l.key}
          name="locked-text"
          x={l.rect.x} y={l.rect.y} width={l.rect.w} height={l.rect.h}
          fill="transparent"
          stroke={interactive && hover === l.key ? CANVAS.locked : undefined}
          strokeWidth={1} strokeScaleEnabled={false} dash={[2, 3]}
          listening={interactive}
          onMouseEnter={(e) => { setHover(l.key); if (tool === "select") setCursor(e, "help"); }}
          onMouseLeave={(e) => { setHover((h) => (h === l.key ? null : h)); if (tool === "select") setCursor(e, ""); }}
          onPointerDown={() => press(l)}
          onDblClick={() => { if (tool === "select") explain(l); }}
          onDblTap={() => { if (tool === "select") explain(l); }}
        />
      ))}
      {paragraphs.filter((p) => p.editable && !edited.has(p.id)).map((p) => (
        <Rect
          key={p.id}
          name="paragraph"
          ref={(n) => { if (n) nodes.current.set(p.id, n); else nodes.current.delete(p.id); }}
          x={p.rect.x} y={p.rect.y} width={p.rect.w} height={p.rect.h}
          fill="transparent"
          stroke={interactive && (hover === p.id || active === p.id) ? OUTLINE : undefined}
          strokeWidth={1} strokeScaleEnabled={false} dash={active === p.id ? undefined : [4, 3]}
          listening={interactive}
          draggable={active === p.id}
          dragDistance={DRAG_DISTANCE}
          onMouseEnter={(e) => { setHover(p.id); setCursor(e, "text"); }}
          onMouseLeave={(e) => { setHover((h) => (h === p.id ? null : h)); setCursor(e, ""); }}
          onPointerDown={(e) => {
            // Not a click on the empty page. With the select tool the press bubbles up unless the paragraph is already
            // selected (then a drag moves it): a drag from original text is a marquee (PageOverlay).
            if (tool !== "select" || active === p.id) e.cancelBubble = true;
            if (tool === "text") { setCursor(e, ""); void startParagraphEdit(pageKey, p); }
            else select(p);
          }}
          onDblClick={(e) => { setCursor(e, ""); void startParagraphEdit(pageKey, p); }}
          onDblTap={(e) => { setCursor(e, ""); void startParagraphEdit(pageKey, p); }}
          onContextMenu={(e) => openMenu(e, p)}
          onDragEnd={(e) => {
            const node = e.target;
            const dx = node.x() - p.rect.x, dy = node.y() - p.rect.y;
            node.position({ x: p.rect.x, y: p.rect.y });
            if (dx || dy) void materializeParagraph(pageKey, p, (box) => ({ ...box, rect: { ...box.rect, x: box.rect.x + dx, y: box.rect.y + dy } }));
          }}
          onTransformStart={() => {
            const r = { id: p.id, base: null as TextBox | null, cancelled: false };
            resizing.current = r;
            paragraphStartBox(p).then((box) => { r.base = box; }).catch((err) => console.warn("paragraph resize: font load failed", err));
          }}
          onTransform={(e) => {
            const r = resizing.current;
            if (!r?.base) return; // fonts still loading: the frame alone follows the pointer
            const node = e.target;
            setPreview({ p, op: paragraphPreview(pageKey, p, r.base, node.x(), Math.max(10, p.rect.w * node.scaleX())) });
          }}
          onTransformEnd={(e) => {
            const node = e.target;
            const cancelled = resizing.current?.cancelled;
            const x = node.x(), w = Math.max(10, p.rect.w * node.scaleX());
            resizing.current = null;
            setPreview(null);
            node.setAttrs({ x: p.rect.x, scaleX: 1, scaleY: 1 });
            if (!cancelled) void materializeParagraph(pageKey, p, resizedParagraph(x, w));
          }}
        />
      ))}
      {ocrShown.map((p) => {
        const low = isLowConfidence(p);
        const on = hover === p.id || selected === p.id;
        return (
          <Rect
            key={p.id}
            name="ocr-paragraph"
            x={p.rect.x - 1} y={p.rect.y - 1} width={p.rect.w + 2} height={p.rect.h + 2}
            fill={on ? (low ? "rgba(217, 119, 6, 0.10)" : "rgba(36, 107, 246, 0.08)") : "transparent"}
            stroke={interactive ? (low ? CANVAS.ocrLow : OUTLINE) : undefined}
            strokeWidth={on ? 1.5 : 1} strokeScaleEnabled={false} dash={selected === p.id ? undefined : [3, 2]}
            listening={interactive}
            onMouseEnter={(e) => { setHover(p.id); setCursor(e, "text"); }}
            onMouseLeave={(e) => { setHover((h) => (h === p.id ? null : h)); setCursor(e, ""); }}
            onPointerDown={(e) => {
              if (tool !== "select") e.cancelBubble = true; // with the select tool a drag from here is a marquee
              if (tool === "text") { setCursor(e, ""); void startOcrEdit(pageKey, p); } else selectOcr(p);
            }}
            onDblClick={(e) => { setCursor(e, ""); void startOcrEdit(pageKey, p); }}
            onDblTap={(e) => { setCursor(e, ""); void startOcrEdit(pageKey, p); }}
            onContextMenu={(e) => openMenu(e, p)}
          />
        );
      })}
      {interactive && ocrShown.filter((p) => hover === p.id || selected === p.id).map((p) => (
        <Label key={`badge-${p.id}`} name="ocr-badge" x={p.rect.x - 1} y={p.rect.y - 3 - BADGE_SIZE - 2 * BADGE_PAD} listening={false}>
          <Tag fill={isLowConfidence(p) ? CANVAS.ocrLow : CANVAS.badge} cornerRadius={2} />
          <Text text={ocrBadge(p)} fontSize={BADGE_SIZE} padding={BADGE_PAD} fill={CANVAS.badgeInk} fontFamily="Geist, system-ui, sans-serif" />
        </Label>
      ))}
      <Transformer ref={trRef} rotateEnabled={false} flipEnabled={false} ignoreStroke keepRatio={false}
        enabledAnchors={["middle-left", "middle-right"]} borderStroke={OUTLINE} anchorStroke={OUTLINE} anchorSize={8} />
    </>
  );
}
