"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type Konva from "konva";
import { Group, Layer, Stage, Transformer } from "react-konva";
import { useStore } from "zustand";
import type { ContentOp } from "@edith/ops";
import { groupTransform, pageBounds, screenSize, type PageGeom } from "@/lib/coords";
import { newId } from "@/lib/id";
import {
  type TextOp, clampToBounds, createFromDrag, DRAG_TOOLS, hasRotation, inkWidth, isMarkup, isPointOp, isResizable, isRotatable, isTextOp, keepRotatedTopLeft, mapPoints, MARKUP_TOOLS,
  MIN_DRAG, moveOp, normalizeRect, normalizeRotation, noteAt, opacityOf, opBounds, POLY_TOOLS, resizeOp, rotateAnchorOffset, rotationOf, symbolAt, type DragTool, type PolyTool, type Pt,
} from "@/lib/objects";
import { charsStore } from "@/store/chars";
import { editorStore, useEditor, type MarkupTool } from "@/store/editor";
import { imagesOf } from "@/store/text";
import { linkStore } from "./marks/linkStore";
import { MarkupShape } from "./marks/MarkupShape";
import { markupFromDrag, onMarkableText } from "./marks/markupTool";
import { ObjectShape } from "./ObjectShape";
import { usePolyTool } from "./shapes/usePolyTool";
import { runPageOcr } from "./text/ocrRun";
import { textEditStore, updateTextOp } from "./text/textEdit";
import { CANVAS } from "@/lib/theme";
import { isMac } from "@/lib/keys";
import { boundsOf, nextBelow, stacked } from "@/lib/zorder";
import { contextMenuStore, menuOpeners } from "./objects/layering";


/** Konva attributes of an object's group: objects with a `rotation` turn around their rect's centre (the group's
 *  origin sits there), and every drawn object has its opacity. */
export function objectGroupAttrs(op: ContentOp) {
  const opacity = opacityOf(op);
  if (!hasRotation(op)) return { x: 0, y: 0, offsetX: 0, offsetY: 0, rotation: 0, opacity };
  const b = opBounds(op);
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  return { x: cx, y: cy, offsetX: cx, offsetY: cy, rotation: rotationOf(op), opacity };
}

/** The op after its group was moved, resized or turned with the Transformer (`g`: the group's node). */
function transformed(cur: ContentOp, g: Konva.Group, page: Konva.Group): ContentOp {
  if (isPointOp(cur)) {
    const m = g.getTransform().copy(); // group space (page coordinates before the change) -> page space
    return mapPoints(cur, ([x, y]) => { const p = m.point({ x, y }); return [p.x, p.y]; });
  }
  if (hasRotation(cur)) {
    const b = opBounds(cur);
    const w = b.w * Math.abs(g.scaleX()), h = b.h * Math.abs(g.scaleY());
    const to = { x: g.x() - w / 2, y: g.y() - h / 2, w, h };
    const rotation = normalizeRotation(g.rotation());
    if (isTextOp(cur) && overlayHooks.resizeText) {
      // Only the width changes; the re-laid-out height may differ: keep the rotated top-left corner (the text's first line) in place.
      const kept = { ...to, y: g.y() - b.h / 2, h: b.h };
      const sized = overlayHooks.resizeText(cur, kept);
      const rect = keepRotatedTopLeft(kept, sized.box.rect, rotation);
      return { ...sized, box: { ...sized.box, rect }, rotation } as ContentOp;
    }
    return { ...resizeOp(cur, to), rotation } as ContentOp;
  }
  const box = g.getClientRect({ relativeTo: page, skipStroke: true });
  const to = { x: box.x, y: box.y, w: box.width, h: box.height };
  return isTextOp(cur) && overlayHooks.resizeText ? overlayHooks.resizeText(cur, to) : resizeOp(cur, to);
}

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

/** Page points around an object's box still tried by stackAt (half the widest stroke and the hit tolerance). */
const HIT_PAD = 12;

/** Below this size (px) a box side gets no middle anchor: on a small object (a check mark) eight anchors hid it. */
const MIDDLE_ANCHOR_MIN = 40;

/** An area dragged with the OCR tool smaller than this (pt, either side) is a slip, not text to read. */
const MIN_OCR_AREA = 8;

/** The Transformer's anchors for a box: its corners, plus the middle of each side long enough to hold one. */
function boxAnchors(op: ContentOp | undefined, scale: number): string[] {
  const b = op ? opBounds(op) : undefined;
  const wide = !b || Math.abs(b.w) * scale >= MIDDLE_ANCHOR_MIN;
  const tall = !b || Math.abs(b.h) * scale >= MIDDLE_ANCHOR_MIN;
  return ["top-left", "top-right", "bottom-left", "bottom-right",
    ...(wide ? ["top-center", "bottom-center"] : []), ...(tall ? ["middle-left", "middle-right"] : [])];
}

export default function PageOverlay({ pageKey, geom, scale }: { pageKey: string; geom: PageGeom; scale: number }) {
  const size = screenSize(geom, scale);
  const tr = groupTransform(geom, scale);
  const order = useEditor((s) => s.doc.order);
  const objects = useEditor((s) => s.doc.objects);
  const selection = useEditor((s) => s.selection);
  const tool = useEditor((s) => s.tool);
  const docId = useEditor((s) => s.info?.docId ?? "");
  const src = useEditor((s) => {
    const entry = s.doc.pages.find((p) => p.pageKey === pageKey);
    return entry && "doc" in entry.src ? entry.src : null;
  });
  // renderText reads the editing id at render time (the edited op is hidden), so re-render when it changes.
  useStore(textEditStore, (s) => s.editing?.id);
  const pageRef = useRef<Konva.Group>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const nodes = useRef(new Map<string, Konva.Group>());
  const [draft, setDraft] = useState<ContentOp | null>(null);
  // The draw in progress. Move/up are tracked on window so a drag released outside the stage still commits.
  const drawing = useRef<{ start: Pt; draft: ContentOp | null; stop: () => void } | null>(null);

  // Stacked as the export draws them (lib/zorder.ts): redactions, drawn objects in z-order, notes, links.
  const mine = stacked(order.map((id) => objects[id]).filter((op): op is ContentOp => !!op && op.pageKey === pageKey));
  // Text markup is drawn in its own (multiplying) layer, over the objects: in the PDF it is an annotation.
  const objs = mine.filter((op) => !isMarkup(op));
  const markups = mine.filter(isMarkup);

  /** The objects under stage point `at` (default: the pointer), topmost first, as the canvas stacks them. */
  function stackAt(at?: { x: number; y: number } | null): string[] {
    const stage = stageRef.current, page = pageRef.current;
    const p = at ?? stage?.getPointerPosition();
    if (!stage || !page || !p) return [];
    // Hit-testing a shape draws it on a stage-sized canvas: only try the objects whose box (padded for strokes and
    // Konva's hit tolerance) holds the point.
    const q = page.getAbsoluteTransform().copy().invert().point(p);
    const near = [...objs, ...markups].filter((op) => {
      const b = boundsOf(op);
      return q.x >= b.x - HIT_PAD && q.x <= b.x + b.w + HIT_PAD && q.y >= b.y - HIT_PAD && q.y <= b.y + b.h + HIT_PAD;
    }).map((op) => op.id);
    if (!near.length) return [];
    const groups = new Map(stage.find(".object").map((g) => [g.id(), g as Konva.Group]));
    return near.filter((id) => groups.get(id)?.find("Shape").some((s) => s.isVisible() && (s as Konva.Shape).intersects(p))).reverse();
  }

  /** A press on object `id` with the select tool: selects it; Alt selects the next object beneath the selection at
   *  the pointer instead (cycling); other buttons leave the selection to the context menu, and so does Ctrl+click on
   *  the Mac (its right-click: selecting the topmost here would lose a selection beneath it). */
  function pressObject(e: Konva.KonvaEventObject<PointerEvent>, id: string) {
    e.cancelBubble = true; // not a press on the empty page
    if (e.evt.button !== 0 || (e.evt.ctrlKey && isMac())) return;
    textEditStore.getState().selectParagraph(null);
    const s = editorStore.getState();
    s.select(e.evt.altKey ? nextBelow(stackAt(), s.selection) ?? id : id);
  }

  function openMenu(target: string, stack: string[], client: { x: number; y: number }) {
    const s = editorStore.getState();
    textEditStore.getState().selectParagraph(null);
    if (s.selection !== target) s.select(target);
    contextMenuStore.getState().open({ x: client.x, y: client.y, target, stack });
  }

  /** Right-click: on an object, selects it (unless the selection is also under the pointer) and opens the object
   *  menu; on a picture of the page (and nothing above it to edit), the picture's menu (Kenali teks (OCR) of it);
   *  elsewhere (the empty page, original text) the browser keeps its own menu. */
  function onContextMenu(e: Konva.KonvaEventObject<MouseEvent>) {
    if (tool !== "select" || textEditStore.getState().editing) return;
    const stack = stackAt();
    if (!stack.length) {
      const at = src ? pageRef.current?.getRelativePointerPosition() : null;
      // The smallest picture under the pointer: a logo over a full-page scan is the one meant.
      const picture = at && src ? imagesOf(src).filter((r) => at.x >= r.x && at.x <= r.x + r.w && at.y >= r.y && at.y <= r.y + r.h)
        .sort((a, b) => a.w * a.h - b.w * b.h)[0] : undefined;
      if (!picture || !src) return;
      e.evt.preventDefault();
      editorStore.getState().select(null);
      textEditStore.getState().selectParagraph(null);
      contextMenuStore.getState().open({ x: e.evt.clientX, y: e.evt.clientY, picture: { pageKey, doc: src.doc, index: src.index, rect: picture } });
      return;
    }
    e.evt.preventDefault();
    const sel = editorStore.getState().selection;
    openMenu(sel !== null && stack.includes(sel) ? sel : stack[0], stack, { x: e.evt.clientX, y: e.evt.clientY });
  }

  // The keyboard's menu key / Shift+F10 opens the menu over the selected object (useShortcuts → menuOpeners).
  useEffect(() => {
    const open = (id: string) => {
      const stage = stageRef.current;
      const node = stage?.find(".object").find((n) => n.id() === id);
      if (!stage || !node) return;
      const r = node.getClientRect({ relativeTo: stage });
      const box = stage.container().getBoundingClientRect();
      const p = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      // An object scrolled out of view: the menu opens at the nearest point of the visible canvas (and the menu
      // keeps itself inside the window).
      const view = document.getElementById("page-scroller")?.getBoundingClientRect();
      const x = box.left + p.x, y = box.top + p.y;
      openMenu(id, stackAt(p), view
        ? { x: Math.min(Math.max(x, view.left), view.right), y: Math.min(Math.max(y, view.top), view.bottom) }
        : { x, y });
    };
    menuOpeners.set(pageKey, open);
    return () => { if (menuOpeners.get(pageKey) === open) menuOpeners.delete(pageKey); };
  });

  useEffect(() => {
    const node = selection ? nodes.current.get(selection) : undefined;
    const tr = trRef.current;
    tr?.nodes(node ? [node] : []);
    if (tr && node) {
      // Keep the rotation handle inside the stage: below the box when the shape is near the page top.
      const top = node.getClientRect({ relativeTo: tr.getStage() ?? undefined }).y;
      tr.rotateAnchorOffset(rotateAnchorOffset(top, tr.height()));
    }
    trRef.current?.getLayer()?.batchDraw();
  }, [selection, mine, objects]);

  // Konva rebuilds a layer's hit graph in a batched draw (requestAnimationFrame, which can lag by hundreds of ms
  // in a busy or background tab). A pointer event in between is hit-tested against the stale graph: right after a
  // tool switch (objects' `listening` flipped) or a new object, the click found nothing and selected nothing.
  // Draw the layers synchronously once React has applied the props, so the hit graph is current before any event.
  useLayoutEffect(() => { stageRef.current?.getLayers().forEach((l) => l.draw()); });

  useEffect(() => () => drawing.current?.stop(), []);
  const poly = usePolyTool(pageKey, POLY_TOOLS.has(tool) ? (tool as PolyTool) : null, scale);

  // Text markup needs the page's character boxes.
  useEffect(() => {
    if (MARKUP_TOOLS.has(tool) && src) void charsStore.getState().load(src.doc, src.index);
  }, [tool, src]);

  /** Page-relative pointer position (clamped to the page); `evt` updates it from an event outside Konva. */
  const pos = (evt?: PointerEvent): Pt => {
    const page = pageRef.current!;
    if (evt) page.getStage()?.setPointersPositions(evt);
    const p = page.getRelativePointerPosition()!;
    return clampToBounds([p.x, p.y], pageBounds(geom));
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
    } else if (tool === "link" || tool === "ocr") {
      // An area to read (OCR) shows as a link's dashed box does while dragged.
      setDrawDraft({ id: "draft", type: "link.add", pageKey, rect: normalizeRect(cur.start, at), target: { url: "https://" } });
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
    } else if (tool === "link") {
      const rect = normalizeRect(cur.start, at);
      if (rect.w >= MIN_DRAG && rect.h >= MIN_DRAG) { s.setTool("select"); linkStore.getState().open({ pageKey, rect }); }
    } else if (tool === "ocr") {
      // Any part of the page read by OCR; its paragraphs join the page's OCR ones (one OCR of a document at a time).
      const rect = normalizeRect(cur.start, at);
      if (src && rect.w >= MIN_OCR_AREA && rect.h >= MIN_OCR_AREA) { s.setTool("select"); void runPageOcr(src.doc, src.index, rect); }
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
    } else if (tool === "check" || tool === "cross") {
      s.addObject(symbolAt(tool, at, s.style, pageKey, newId(), geom)); // stays active for the next one
    } else if (tool === "note") {
      const note = noteAt(at, s.style, pageKey, newId(), geom);
      s.addObject(note);
      s.setTool("select");
      s.select(note.id);
      linkStore.getState().setFocusNote(note.id); // the properties bar shows its text field
    } else if (POLY_TOOLS.has(tool)) {
      poly.click(at);
    } else if (tool === "link" || tool === "ocr" || DRAG_TOOLS.has(tool)) {
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
        ref={stageRef}
        width={size.width}
        height={size.height}
        onPointerDown={onDown}
        onPointerMove={() => { if (poly.active) poly.hover(pos()); }}
        onDblClick={() => poly.doubleClick()}
        onContextMenu={onContextMenu}
      >
        <Layer>
          <Group ref={pageRef} x={tr.x} y={tr.y} rotation={tr.rotation} scaleX={tr.scale} scaleY={tr.scale} offsetX={tr.offsetX} offsetY={tr.offsetY}>
            {overlayHooks.renderUnder?.(pageKey)}
            {objs.map((op) => (
              <Group
                key={op.id}
                ref={(n) => { if (n) nodes.current.set(op.id, n); else nodes.current.delete(op.id); }}
                name="object"
                id={op.id}
                {...objectGroupAttrs(op)}
                draggable={tool === "select"}
                listening={tool === "select"}
                onPointerDown={(e) => { if (tool === "select") pressObject(e, op.id); }}
                // Alt+drag would move the object on top, not the one Alt+click picked beneath it.
                onDragStart={(e) => { if (e.evt?.altKey) e.target.stopDrag(); }}
                onDragEnd={(e) => {
                  const g = e.currentTarget as Konva.Group;
                  const cur = editorStore.getState().doc.objects[op.id];
                  const home = objectGroupAttrs(cur ?? op);
                  const dx = g.x() - home.x, dy = g.y() - home.y;
                  g.position({ x: home.x, y: home.y });
                  if (cur && (dx || dy)) updateTextOp(op.id, moveOp(cur, dx, dy));
                }}
                onTransformEnd={(e) => {
                  const g = e.currentTarget as Konva.Group;
                  const cur = editorStore.getState().doc.objects[op.id];
                  const next = cur ? transformed(cur, g, pageRef.current!) : null;
                  g.setAttrs({ ...objectGroupAttrs(next ?? op), scaleX: 1, scaleY: 1 });
                  if (next) updateTextOp(op.id, next);
                }}
                onDblClick={() => overlayHooks.onDoubleClick?.(op)}
              >
                {isTextOp(op)
                  ? overlayHooks.renderText?.(op, selection === op.id) ?? null
                  : <ObjectShape op={op} docId={docId} />}
              </Group>
            ))}
            {draft && !isMarkup(draft) && <Group opacity={opacityOf(draft)}><ObjectShape op={draft} docId={docId} /></Group>}
            {poly.preview && <Group opacity={opacityOf(poly.preview)} listening={false}><ObjectShape op={poly.preview} docId={docId} /></Group>}
            {overlayHooks.renderOver?.(pageKey)}
          </Group>
          <Transformer
            ref={trRef}
            rotateEnabled={!!selection && isRotatable(objects[selection])}
            rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]}
            rotationSnapTolerance={4}
            flipEnabled={false}
            resizeEnabled={!selection || isResizable(objects[selection])}
            // A note's icon is as big as its selection box: pad it so the border shows outside the icon's.
            padding={selection && !isResizable(objects[selection]) ? 3 : 0}
            ignoreStroke
            keepRatio={false}
            enabledAnchors={selection && isTextOp(objects[selection])
              ? ["middle-left", "middle-right"]
              : boxAnchors(selection ? objects[selection] : undefined, tr.scale)}
            borderStroke={CANVAS.accent}
            anchorStroke={CANVAS.accent}
            anchorSize={8}
          />
        </Layer>
        <Layer ref={multiplyLayer} listening={tool === "select"}>
          <Group x={tr.x} y={tr.y} rotation={tr.rotation} scaleX={tr.scale} scaleY={tr.scale} offsetX={tr.offsetX} offsetY={tr.offsetY}>
            {markups.map((op) => (
              <Group key={op.id} name="object" id={op.id} onPointerDown={(e) => pressObject(e, op.id)}
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
