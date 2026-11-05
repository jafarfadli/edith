"use client";

import { useEffect, useRef, useState } from "react";
import type Konva from "konva";
import { Group, Layer, Stage, Transformer } from "react-konva";
import { useStore } from "zustand";
import type { ContentOp, TextAdd, TextEdit } from "@edith/ops";
import { groupTransform, screenSize, type PageGeom } from "@/lib/coords";
import { newId } from "@/lib/id";
import { clampToPage, createFromDrag, DRAG_TOOLS, inkWidth, isMarkup, isResizable, isTextOp, MARKUP_TOOLS, moveOp, resizeOp, type DragTool, type Pt } from "@/lib/objects";
import { charsStore } from "@/store/chars";
import { editorStore, useEditor, type MarkupTool } from "@/store/editor";
import { MarkupShape } from "./marks/MarkupShape";
import { markupFromDrag, onMarkableText } from "./marks/markupTool";
import { ObjectShape } from "./ObjectShape";
import { textEditStore } from "./text/textEdit";

type TextOp = TextAdd | TextEdit;

/** Highlights multiply over the pdf.js canvas below (as their /BM /Multiply appearance does in a
 *  viewer), so text under them stays dark: the markup layer's canvas blends with the page. */
function multiplyLayer(layer: Konva.Layer | null) {
  if (layer) layer.getNativeCanvasElement().style.mixBlendMode = "multiply";
}

export const overlayHooks: {
  onTextPointerDown?: (pageKey: string, at: Pt) => void;
  renderText?: (op: TextOp, selected: boolean) => React.ReactNode;
  resizeText?: (op: TextOp, to: { x: number; y: number; w: number; h: number }) => TextOp;
  onDoubleClick?: (op: ContentOp) => void;
  /** A double-click on a text markup (select tool): edit the text under it at `at`. */
  onMarkupDoubleClick?: (pageKey: string, at: Pt) => void;
  /** Konva nodes drawn under the page's objects (original paragraphs). */
  renderUnder?: (pageKey: string) => React.ReactNode;
  /** Konva nodes drawn over the page's objects (search highlights). */
  renderOver?: (pageKey: string) => React.ReactNode;
} = {};

export default function PageOverlay({ pageKey, geom, scale }: { pageKey: string; geom: PageGeom; scale: number }) {
  const size = screenSize(geom, scale);
  const tr = groupTransform(geom, scale);
  const order = useEditor((s) => s.doc.order);
  const objects = useEditor((s) => s.doc.objects);
  const selection = useEditor((s) => s.selection);
  const tool = useEditor((s) => s.tool);
  const docId = useEditor((s) => s.info?.docId ?? "");
  const srcIndex = useEditor((s) => {
    const entry = s.doc.pages.find((p) => p.pageKey === pageKey);
    return entry && "doc" in entry.src ? entry.src.index : null;
  });
  // renderText reads the editing id at render time (the edited op is hidden), so re-render when it changes.
  useStore(textEditStore, (s) => s.editing?.id);
  const pageRef = useRef<Konva.Group>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const nodes = useRef(new Map<string, Konva.Group>());
  const [draft, setDraft] = useState<ContentOp | null>(null);
  // The draw in progress. Move/up are tracked on window so a drag released outside the stage still commits.
  const drawing = useRef<{ start: Pt; draft: ContentOp | null; stop: () => void } | null>(null);

  const mine = order.map((id) => objects[id]).filter((op): op is ContentOp => !!op && op.pageKey === pageKey);
  // Text markup is drawn in its own (multiplying) layer, over the objects: in the PDF it is an annotation.
  const objs = mine.filter((op) => !isMarkup(op));
  const markups = mine.filter(isMarkup);

  useEffect(() => {
    const node = selection ? nodes.current.get(selection) : undefined;
    trRef.current?.nodes(node ? [node] : []);
    trRef.current?.getLayer()?.batchDraw();
  }, [selection, mine]);

  useEffect(() => () => drawing.current?.stop(), []);

  // Text markup needs the page's character boxes.
  useEffect(() => {
    if (MARKUP_TOOLS.has(tool) && docId && srcIndex !== null) void charsStore.getState().load(docId, srcIndex);
  }, [tool, docId, srcIndex]);

  /** Page-relative pointer position (clamped to the page); `evt` updates it from an event outside Konva. */
  const pos = (evt?: PointerEvent): Pt => {
    const page = pageRef.current!;
    if (evt) page.getStage()?.setPointersPositions(evt);
    const p = page.getRelativePointerPosition()!;
    return clampToPage([p.x, p.y], geom.width, geom.height);
  };

  function setDrawDraft(d: ContentOp | null) {
    if (drawing.current) drawing.current.draft = d;
    setDraft(d);
  }

  function extendInk(d: ContentOp, at: Pt): ContentOp {
    const path = (d as { paths: number[][][] }).paths[0];
    const last = path[path.length - 1];
    if (last && last[0] === at[0] && last[1] === at[1]) return d;
    return { ...d, paths: [[...path, at]] } as unknown as ContentOp;
  }

  function onMove(at: Pt) {
    const cur = drawing.current;
    if (!cur) return;
    if (tool === "ink") {
      if (cur.draft) setDrawDraft(extendInk(cur.draft, at));
    } else if (MARKUP_TOOLS.has(tool)) {
      setDrawDraft(markupFromDrag(tool as MarkupTool, pageKey, cur.start, at, "draft"));
    } else if (DRAG_TOOLS.has(tool)) {
      setDrawDraft(createFromDrag(tool as DragTool, cur.start, at, editorStore.getState().style, pageKey, "draft"));
    }
  }

  function onUp(at: Pt) {
    const cur = drawing.current;
    if (!cur) return;
    cur.stop();
    const s = editorStore.getState();
    if (tool === "ink" && cur.draft) {
      s.addObject({ ...extendInk(cur.draft, at), id: newId() } as ContentOp);
    } else if (MARKUP_TOOLS.has(tool)) {
      const op = markupFromDrag(tool as MarkupTool, pageKey, cur.start, at, newId());
      if (op) s.addObject(op); // the markup tools stay active
    } else if (DRAG_TOOLS.has(tool)) {
      const op = createFromDrag(tool as DragTool, cur.start, at, s.style, pageKey, newId());
      if (op) { s.addObject(op); s.setTool("select"); s.select(op.id); }
    }
    setDraft(null);
  }

  function beginDraw(at: Pt, first: ContentOp | null) {
    drawing.current?.stop();
    const move = (evt: PointerEvent) => {
      if (evt.buttons === 0) onUp(pos(evt)); // the release was missed (e.g. outside the window)
      else onMove(pos(evt));
    };
    const up = (evt: PointerEvent) => onUp(pos(evt));
    const cancel = () => { drawing.current?.stop(); setDraft(null); };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      drawing.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    drawing.current = { start: at, draft: first, stop };
    setDraft(first);
  }

  function onDown(e: Konva.KonvaEventObject<PointerEvent>) {
    const s = editorStore.getState();
    if (tool === "select") {
      if (e.target === e.target.getStage()) { s.select(null); textEditStore.getState().selectParagraph(null); }
      return;
    }
    const at = pos();
    if (tool === "text") { overlayHooks.onTextPointerDown?.(pageKey, at); return; }
    if (MARKUP_TOOLS.has(tool)) {
      if (onMarkableText(pageKey, at)) beginDraw(at, null);
    } else if (DRAG_TOOLS.has(tool)) {
      beginDraw(at, null);
    } else if (tool === "ink") {
      beginDraw(at, { id: "draft", type: "ink.add", pageKey, paths: [[at]], color: s.style.stroke, width: inkWidth(s.style.width) } as ContentOp);
    }
  }

  return (
    <div
      data-testid="overlay"
      className="absolute inset-0"
      style={{ pointerEvents: tool === "pan" ? "none" : "auto", cursor: tool === "select" ? "default" : MARKUP_TOOLS.has(tool) ? "text" : "crosshair" }}
    >
      <Stage
        width={size.width}
        height={size.height}
        onPointerDown={onDown}
      >
        <Layer>
          <Group ref={pageRef} x={tr.x} y={tr.y} rotation={tr.rotation} scaleX={tr.scale} scaleY={tr.scale}>
            {overlayHooks.renderUnder?.(pageKey)}
            {objs.map((op) => (
              <Group
                key={op.id}
                ref={(n) => { if (n) nodes.current.set(op.id, n); else nodes.current.delete(op.id); }}
                draggable={tool === "select"}
                listening={tool === "select"}
                onPointerDown={(e) => {
                  if (tool !== "select") return;
                  e.cancelBubble = true;
                  textEditStore.getState().selectParagraph(null);
                  editorStore.getState().select(op.id);
                }}
                onDragEnd={(e) => {
                  const g = e.currentTarget as Konva.Group;
                  const dx = g.x(), dy = g.y();
                  g.position({ x: 0, y: 0 });
                  const cur = editorStore.getState().doc.objects[op.id];
                  if (cur && (dx || dy)) editorStore.getState().updateObject(op.id, moveOp(cur, dx, dy));
                }}
                onTransformEnd={(e) => {
                  const g = e.currentTarget as Konva.Group;
                  const box = g.getClientRect({ relativeTo: pageRef.current!, skipStroke: true });
                  g.setAttrs({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 });
                  const cur = editorStore.getState().doc.objects[op.id];
                  if (!cur) return;
                  const to = { x: box.x, y: box.y, w: box.width, h: box.height };
                  const next = isTextOp(cur) && overlayHooks.resizeText
                    ? overlayHooks.resizeText(cur, to)
                    : resizeOp(cur, to);
                  editorStore.getState().updateObject(op.id, next);
                }}
                onDblClick={() => overlayHooks.onDoubleClick?.(op)}
              >
                {isTextOp(op)
                  ? overlayHooks.renderText?.(op, selection === op.id) ?? null
                  : <ObjectShape op={op} docId={docId} />}
              </Group>
            ))}
            {draft && !isMarkup(draft) && <ObjectShape op={draft} docId={docId} />}
            {overlayHooks.renderOver?.(pageKey)}
          </Group>
          <Transformer
            ref={trRef}
            rotateEnabled={false}
            resizeEnabled={!selection || isResizable(objects[selection])}
            // A note's icon is as big as its selection box: pad it so the border shows outside the icon's.
            padding={selection && !isResizable(objects[selection]) ? 3 : 0}
            ignoreStroke
            keepRatio={false}
            enabledAnchors={selection && isTextOp(objects[selection])
              ? ["middle-left", "middle-right"]
              : ["top-left", "top-center", "top-right", "middle-left", "middle-right", "bottom-left", "bottom-center", "bottom-right"]}
            borderStroke="#0f766e"
            anchorStroke="#0f766e"
            anchorSize={8}
          />
        </Layer>
        <Layer ref={multiplyLayer} listening={tool === "select"}>
          <Group x={tr.x} y={tr.y} rotation={tr.rotation} scaleX={tr.scale} scaleY={tr.scale}>
            {markups.map((op) => (
              <Group key={op.id} onPointerDown={(e) => {
                e.cancelBubble = true;
                textEditStore.getState().selectParagraph(null);
                editorStore.getState().select(op.id);
              }}
              // The markup layer is above the text: a double-click edits the text under the markup.
              onDblClick={() => overlayHooks.onMarkupDoubleClick?.(pageKey, pos())}
              onDblTap={() => overlayHooks.onMarkupDoubleClick?.(pageKey, pos())}>
                <MarkupShape op={op} selected={selection === op.id} />
              </Group>
            ))}
            {draft && isMarkup(draft) && <MarkupShape op={draft} />}
          </Group>
        </Layer>
      </Stage>
    </div>
  );
}
