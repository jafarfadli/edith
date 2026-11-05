"use client";

import { useEffect, useRef, useState } from "react";
import type Konva from "konva";
import { Group, Layer, Stage, Transformer } from "react-konva";
import { useStore } from "zustand";
import type { ContentOp, TextAdd } from "@edith/ops";
import { groupTransform, screenSize, type PageGeom } from "@/lib/coords";
import { newId } from "@/lib/id";
import { createFromDrag, DRAG_TOOLS, moveOp, resizeOp, type DragTool, type Pt } from "@/lib/objects";
import { editorStore, useEditor } from "@/store/editor";
import { ObjectShape } from "./ObjectShape";
import { textEditStore } from "./text/textEdit";

export const overlayHooks: {
  onTextPointerDown?: (pageKey: string, at: Pt) => void;
  renderText?: (op: TextAdd, selected: boolean) => React.ReactNode;
  resizeText?: (op: TextAdd, to: { x: number; y: number; w: number; h: number }) => TextAdd;
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
  const start = useRef<Pt | null>(null);
  const [draft, setDraft] = useState<ContentOp | null>(null);

  const mine = order.map((id) => objects[id]).filter((op): op is ContentOp => !!op && op.pageKey === pageKey);

  useEffect(() => {
    const node = selection ? nodes.current.get(selection) : undefined;
    trRef.current?.nodes(node ? [node] : []);
    trRef.current?.getLayer()?.batchDraw();
  }, [selection, mine]);

  const pos = (): Pt => {
    const p = pageRef.current!.getRelativePointerPosition()!;
    return [p.x, p.y];
  };

  function onDown(e: Konva.KonvaEventObject<PointerEvent>) {
    const s = editorStore.getState();
    if (tool === "select") {
      if (e.target === e.target.getStage()) s.select(null);
      return;
    }
    const at = pos();
    if (tool === "text") { overlayHooks.onTextPointerDown?.(pageKey, at); return; }
    if (DRAG_TOOLS.has(tool)) {
      start.current = at;
      setDraft(null);
    } else if (tool === "ink") {
      start.current = at;
      setDraft({ id: "draft", type: "ink.add", pageKey, paths: [[at]], color: s.style.stroke, width: s.style.width } as ContentOp);
    }
  }

  function onMove(e: Konva.KonvaEventObject<PointerEvent>) {
    if (!start.current) return;
    if (e.evt.buttons === 0) { start.current = null; setDraft(null); return; } // released outside the stage
    const s = editorStore.getState();
    const at = pos();
    if (tool === "ink") {
      setDraft((d) => d && ({ ...d, paths: [[...((d as { paths: number[][][] }).paths[0]), at]] } as unknown as ContentOp));
    } else if (DRAG_TOOLS.has(tool)) {
      setDraft(createFromDrag(tool as DragTool, start.current, at, s.style, pageKey, "draft"));
    }
  }

  function onUp() {
    if (!start.current) return;
    const s = editorStore.getState();
    const at = pos();
    if (tool === "ink" && draft) {
      s.addObject({ ...draft, id: newId() } as ContentOp);
    } else if (DRAG_TOOLS.has(tool)) {
      const op = createFromDrag(tool as DragTool, start.current, at, s.style, pageKey, newId());
      if (op) { s.addObject(op); s.setTool("select"); s.select(op.id); }
    }
    start.current = null;
    setDraft(null);
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
        onPointerMove={onMove}
        onPointerUp={onUp}
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
                  const next = cur.type === "text.add" && overlayHooks.resizeText
                    ? overlayHooks.resizeText(cur as TextAdd, to)
                    : resizeOp(cur, to);
                  editorStore.getState().updateObject(op.id, next);
                }}
                onDblClick={() => overlayHooks.onDoubleClick?.(op)}
              >
                {op.type === "text.add"
                  ? overlayHooks.renderText?.(op as TextAdd, selection === op.id) ?? null
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
            enabledAnchors={selection && objects[selection]?.type === "text.add"
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
