"use client";

import { useEffect, useRef, useState } from "react";
import type Konva from "konva";
import { Rect, Transformer } from "react-konva";
import { useStore } from "zustand";
import type { TextEdit } from "@edith/ops";
import type { Paragraph } from "@/lib/api";
import { maskRects } from "@/lib/paragraphs";
import { editorStore, useEditor } from "@/store/editor";
import { paragraphsOf, useText } from "@/store/text";
import { materializeParagraph, startParagraphEdit, textEditStore } from "./textEdit";
import { CANVAS } from "@/lib/theme";

const OUTLINE = CANVAS.accent;
/** Screen pixels the pointer must move before a press on the selected paragraph becomes a drag. */
const DRAG_DISTANCE = 3;

function setCursor(e: Konva.KonvaEventObject<unknown>, cursor: string) {
  const c = e.target.getStage()?.container();
  if (c) c.style.cursor = cursor;
}

/** Under the page's objects: white covers over edited paragraphs (the bake redacts them) and, for
 *  the select and text tools, hover/select/drag/resize targets over the paragraphs not edited yet. */
export function ParagraphLayer({ pageKey }: { pageKey: string }) {
  const entry = useEditor((s) => s.doc.pages.find((p) => p.pageKey === pageKey));
  const order = useEditor((s) => s.doc.order);
  const objects = useEditor((s) => s.doc.objects);
  const tool = useEditor((s) => s.tool);
  const pages = useText((s) => s.pages);
  const editing = useStore(textEditStore, (s) => s.editing);
  const selected = useStore(textEditStore, (s) => (s.paragraph?.pageKey === pageKey ? s.paragraph.id : null));
  const [hover, setHover] = useState<string | null>(null);
  const nodes = useRef(new Map<string, Konva.Rect>());
  const trRef = useRef<Konva.Transformer>(null);

  const paragraphs = entry ? paragraphsOf(entry.src, pages) : [];
  const edited = new Set(order.map((id) => objects[id])
    .filter((op): op is TextEdit => op?.type === "text.edit" && op.pageKey === pageKey)
    .map((op) => op.paragraphId));
  if (editing?.kind === "text.edit" && editing.pageKey === pageKey && editing.paragraphId) edited.add(editing.paragraphId);
  const interactive = tool === "select" || tool === "text";
  // The selected paragraph only keeps its handles while it is still an original one under the select tool.
  const active = selected && tool === "select" && !edited.has(selected) ? selected : null;

  useEffect(() => {
    const node = active ? nodes.current.get(active) : undefined;
    trRef.current?.nodes(node ? [node] : []);
    trRef.current?.getLayer()?.batchDraw();
  }, [active, pages]);

  if (!paragraphs.length) return null;

  const select = (p: Paragraph) => {
    editorStore.getState().select(null);
    textEditStore.getState().selectParagraph({ pageKey, id: p.id });
  };

  return (
    <>
      {paragraphs.filter((p) => edited.has(p.id)).flatMap((p) => maskRects(p).map((r, i) => (
        <Rect key={`mask-${p.id}-${i}`} x={r.x} y={r.y} width={r.w} height={r.h} fill="#ffffff" listening={false} />
      )))}
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
            e.cancelBubble = true; // not a click on the empty page
            if (tool === "text") { setCursor(e, ""); void startParagraphEdit(pageKey, p); }
            else select(p);
          }}
          onDblClick={(e) => { setCursor(e, ""); void startParagraphEdit(pageKey, p); }}
          onDblTap={(e) => { setCursor(e, ""); void startParagraphEdit(pageKey, p); }}
          onDragEnd={(e) => {
            const node = e.target;
            const dx = node.x() - p.rect.x, dy = node.y() - p.rect.y;
            node.position({ x: p.rect.x, y: p.rect.y });
            if (dx || dy) void materializeParagraph(pageKey, p, (box) => ({ ...box, rect: { ...box.rect, x: box.rect.x + dx, y: box.rect.y + dy } }));
          }}
          onTransformEnd={(e) => {
            const node = e.target;
            const x = node.x(), w = Math.max(10, p.rect.w * node.scaleX());
            node.setAttrs({ x: p.rect.x, scaleX: 1, scaleY: 1 });
            void materializeParagraph(pageKey, p, (box) => ({ ...box, rect: { ...box.rect, x, w: Math.max(10, box.rect.w + w - p.rect.w) } }));
          }}
        />
      ))}
      <Transformer ref={trRef} rotateEnabled={false} flipEnabled={false} ignoreStroke keepRatio={false}
        enabledAnchors={["middle-left", "middle-right"]} borderStroke={OUTLINE} anchorStroke={OUTLINE} anchorSize={8} />
    </>
  );
}
