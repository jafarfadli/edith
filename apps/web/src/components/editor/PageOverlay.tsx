"use client";

import { useEffect, useRef, useState } from "react";
import type Konva from "konva";
import { Group, Layer, Stage, Transformer } from "react-konva";
import { useStore } from "zustand";
import type { ContentOp, TextAdd, TextEdit } from "@edith/ops";
import { groupTransform, screenSize, type PageGeom } from "@/lib/coords";
import { newId } from "@/lib/id";
import { clampToPage, createFromDrag, DRAG_TOOLS, inkWidth, isTextOp, moveOp, resizeOp, type DragTool, type Pt } from "@/lib/objects";
import { editorStore, useEditor } from "@/store/editor";
import { ObjectShape } from "./ObjectShape";
import { textEditStore } from "./text/textEdit";

type TextOp = TextAdd | TextEdit;

export const overlayHooks: {
  onTextPointerDown?: (pageKey: string, at: Pt) => void;
  renderText?: (op: TextOp, selected: boolean) => React.ReactNode;
  resizeText?: (op: TextOp, to: { x: number; y: number; w: number; h: number }) => TextOp;
  onDoubleClick?: (op: ContentOp) => void;
} = {};

export default function PageOverlay({ pageKey, geom, scale }: { pageKey: string; geom: PageGeom; scale: number }) {
  const size = screenSize(geom, scale);
  const tr = groupTransform(geom, scale);
  const order = useEditor((s) => s.doc.order);
  const objects = useEditor((s) => s.doc.objects);
  const selection = useEditor((s) => s.selection);
  const tool = useEditor((s) => s.tool);
  const docId = useEditor((s) => s.info?.docId ?? "");
  // renderText reads the editing id at render time (the edited op is hidden), so re-render when it changes.
  useStore(textEditStore, (s) => s.editing?.id);
  const pageRef = useRef<Konva.Group>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const nodes = useRef(new Map<string, Konva.Group>());
  const [draft, setDraft] = useState<ContentOp | null>(null);
  // The draw in progress. Move/up are tracked on window so a drag released outside the stage still commits.
  const drawing = useRef<{ start: Pt; draft: ContentOp | null; stop: () => void } | null>(null);

  const mine = order.map((id) => objects[id]).filter((op): op is ContentOp => !!op && op.pageKey === pageKey);

  useEffect(() => {
    const node = selection ? nodes.current.get(selection) : undefined;
    trRef.current?.nodes(node ? [node] : []);
    trRef.current?.getLayer()?.batchDraw();
  }, [selection, mine]);

  useEffect(() => () => drawing.current?.stop(), []);

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
      if (e.target === e.target.getStage()) s.select(null);
      return;
    }
    const at = pos();
    if (tool === "text") { overlayHooks.onTextPointerDown?.(pageKey, at); return; }
    if (DRAG_TOOLS.has(tool)) {
      beginDraw(at, null);
    } else if (tool === "ink") {
      beginDraw(at, { id: "draft", type: "ink.add", pageKey, paths: [[at]], color: s.style.stroke, width: inkWidth(s.style.width) } as ContentOp);
    }
  }

  return (
    <div
      data-testid="overlay"
      className="absolute inset-0"
      style={{ pointerEvents: tool === "pan" ? "none" : "auto", cursor: tool === "select" ? "default" : "crosshair" }}
    >
      <Stage
        width={size.width}
        height={size.height}
        onPointerDown={onDown}
      >
        <Layer>
          <Group ref={pageRef} x={tr.x} y={tr.y} rotation={tr.rotation} scaleX={tr.scale} scaleY={tr.scale}>
            {mine.map((op) => (
              <Group
                key={op.id}
                ref={(n) => { if (n) nodes.current.set(op.id, n); else nodes.current.delete(op.id); }}
                draggable={tool === "select"}
                listening={tool === "select"}
                onPointerDown={(e) => { if (tool === "select") { e.cancelBubble = true; editorStore.getState().select(op.id); } }}
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
            {draft && <ObjectShape op={draft} docId={docId} />}
          </Group>
          <Transformer
            ref={trRef}
            rotateEnabled={false}
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
      </Stage>
    </div>
  );
}
