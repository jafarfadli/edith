"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type Konva from "konva";
import { Group, Layer, Rect, Stage, Transformer } from "react-konva";
import { useStore } from "zustand";
import type { ContentOp } from "@edith/ops";
import type { Rect as Box } from "@edith/ops";
import { groupTransform, pageBounds, screenSize, toPage, toScreen, type PageGeom } from "@/lib/coords";
import { newId } from "@/lib/id";
import {
  type TextOp, clampToBounds, createFromDrag, DRAG_TOOLS, hasRotation, inkWidth, isMarkup, isPointOp, isResizable, isRotatable, isTextOp, keepRotatedTopLeft, mapPoints, MARKUP_TOOLS,
  MIN_DRAG, normalizeRect, normalizeRotation, noteAt, opacityOf, opBounds, POLY_TOOLS, resizeOp, rotateAnchorOffset, rotationOf, symbolAt, type DragTool, type PolyTool, type Pt,
} from "@/lib/objects";
import { charsStore } from "@/store/chars";
import { editorStore, useEditor, type MarkupTool } from "@/store/editor";
import { imagesOf } from "@/store/text";
import { linkStore } from "./marks/linkStore";
import { MarkupShape } from "./marks/MarkupShape";
import { markupFromDrag, onMarkableText } from "./marks/markupTool";
import { ObjectShape } from "./ObjectShape";
import { usePolyTool } from "./shapes/usePolyTool";
import { liveResizeStore, setLiveResize } from "./text/liveResize";
import { runPageOcr } from "./text/ocrRun";
import { isDeletedText, textEditStore, updateTextOp } from "./text/textEdit";
import { CANVAS } from "@/lib/theme";
import { modHeld } from "@/lib/modKeys";
import { boundsUnion, fmtPt, snapResize } from "@/lib/snap";
import { boundsOf, stacked } from "@/lib/zorder";
import { snapStore } from "@/store/snap";
import { useSpaceHeld } from "@/store/view";
import { contextMenuStore, menuOpeners } from "./objects/layering";
import { resizeGroup } from "./objects/groupResize";
import { SnapGuides } from "./objects/SnapGuides";
import { sizeBadge, snapTargets } from "./objects/snapTargets";
import { useAltMeasure } from "./objects/useAltMeasure";
import { useMarquee } from "./objects/useMarquee";
import { SNAP_PX, useObjectDrag } from "./objects/useObjectDrag";


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

/** A box as the Transformer's boundBoxFunc gets it (stage pixels; rotation in radians). */
type TrBox = { x: number; y: number; width: number; height: number; rotation: number };

function setCursor(e: Konva.KonvaEventObject<unknown>, cursor: string) {
  const c = e.target.getStage()?.container();
  if (c) c.style.cursor = cursor;
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
  renderUnder?: (pageKey: string, geom: PageGeom, scale: number) => React.ReactNode;
  /** Konva nodes drawn over the page's objects (search highlights). */
  renderOver?: (pageKey: string) => React.ReactNode;
} = {};

/** Konva names of the original-text targets of ParagraphLayer: a press on one that is not draggable can start a marquee. */
const TEXT_TARGETS: ReadonlySet<string> = new Set(["paragraph", "ocr-paragraph", "locked-text"]);

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
  const selected = useEditor((s) => s.selected);
  const space = useSpaceHeld(); // Space held: the pointer goes through to the scroller, which pans
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
  const groupTrRef = useRef<Konva.Transformer>(null);
  const groupRef = useRef<Konva.Rect>(null);
  // Escape while a handle is dragged: the object goes back as it was (set before the Transformer ends the drag), and
  // stays selected (the capture phase comes before the shortcut that deselects).
  const cancelled = useRef(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tr = trRef.current;
      if (e.key !== "Escape" || !tr?.isTransforming()) return;
      e.stopPropagation();
      cancelled.current = true;
      tr.stopTransform();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  const stageRef = useRef<Konva.Stage>(null);
  const nodes = useRef(new Map<string, Konva.Group>());
  const [draft, setDraft] = useState<ContentOp | null>(null);
  const resizeTargets = useRef<Box[] | null>(null); // what the resize in progress snaps to (read at its first move)
  useEffect(() => { modHeld(); }, []); // start tracking Cmd/Ctrl: the Transformer's resize gets no event
  // The draw in progress. Move/up are tracked on window so a drag released outside the stage still commits.
  const drawing = useRef<{ start: Pt; draft: ContentOp | null; stop: () => void } | null>(null);

  // Stacked as the export draws them (lib/zorder.ts): redactions, drawn objects in z-order, notes, links.
  const mine = stacked(order.map((id) => objects[id]).filter((op): op is ContentOp => !!op && op.pageKey === pageKey));
  // Text markup is drawn in its own (multiplying) layer, over the objects: in the PDF it is an annotation.
  const objs = mine.filter((op) => !isMarkup(op));
  const markups = mine.filter(isMarkup);
  // A group (several selected): each member outlined, and the box around them all.
  const picked = selected.length > 1 ? selected.map((id) => objects[id]).filter((op): op is ContentOp => !!op && op.pageKey === pageKey) : [];
  const groupBox = picked.length > 1 ? boundsUnion(picked.map(boundsOf)) : null;

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

  // Pressing and dragging objects (select, Shift+click, group move, Alt+click / Alt+drag): see useObjectDrag.
  const objectDrag = useObjectDrag({
    pageKey, geom, scale, nodes, stackAt: () => stackAt(),
    home: (op) => { const a = objectGroupAttrs(op); return { x: a.x, y: a.y }; },
  });

  // Alt over another object while something is selected: the distances between them.
  const altMeasure = useAltMeasure(pageKey, tool === "select", () => stackAt());

  function openMenu(target: string, stack: string[], client: { x: number; y: number }) {
    const s = editorStore.getState();
    textEditStore.getState().selectParagraph(null);
    if (!s.selected.includes(target)) s.select(target); // a member of the group: the menu acts on the group
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
    const sel = editorStore.getState().selected;
    openMenu(stack.find((id) => sel.includes(id)) ?? stack[0], stack, { x: e.evt.clientX, y: e.evt.clientY });
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
    // The handles are for one object; a group gets its box (drawn below) and moves as one.
    const node = selection && selected.length === 1 ? nodes.current.get(selection) : undefined;
    const tr = trRef.current;
    tr?.nodes(node ? [node] : []);
    if (tr && node) {
      // Keep the rotation handle inside the stage: below the box when the shape is near the page top.
      const top = node.getClientRect({ relativeTo: tr.getStage() ?? undefined }).y;
      tr.rotateAnchorOffset(rotateAnchorOffset(top, tr.height()));
    }
    trRef.current?.getLayer()?.batchDraw();
  }, [selection, selected, mine, objects]);

  const groupKey = groupBox ? `${groupBox.x},${groupBox.y},${groupBox.w},${groupBox.h}` : "";
  useEffect(() => {
    const tr = groupTrRef.current;
    tr?.nodes(groupBox && groupRef.current ? [groupRef.current] : []);
    tr?.getLayer()?.batchDraw();
  }, [groupKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Konva rebuilds a layer's hit graph in a batched draw (requestAnimationFrame, which can lag by hundreds of ms
  // in a busy or background tab). A pointer event in between is hit-tested against the stale graph: right after a
  // tool switch (objects' `listening` flipped) or a new object, the click found nothing and selected nothing.
  // Draw the layers synchronously once React has applied the props, so the hit graph is current before any event.
  useLayoutEffect(() => { stageRef.current?.getLayers().forEach((l) => l.draw()); });

  useEffect(() => () => drawing.current?.stop(), []);
  // Another tool (Escape: Pilih) while dragging cancels the drag: its release must not still act as the old tool (an
  // area read by OCR, a shape added).
  useEffect(() => () => { if (drawing.current) { drawing.current.stop(); setDraft(null); } }, [tool]);
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

  /** The Transformer's resize with smart guides: the edges being dragged snap to the page and the other objects
   *  (Cmd/Ctrl: off). Only an upright object on an upright page (a turned box is not axis-aligned on screen). */
  function snapResizeBox(old: TrBox, next: TrBox): TrBox {
    const flat = (b: TrBox) => Math.abs(b.rotation) < 1e-6;
    if (!selection || selected.length !== 1 || !flat(old) || !flat(next) || modHeld()) { snapStore.getState().clear(); return next; }
    const targets = (resizeTargets.current ??= snapTargets(pageKey, new Set([selection])));
    const toRect = (b: TrBox) => normalizeRect(toPage([b.x, b.y], geom, scale), toPage([b.x + b.width, b.y + b.height], geom, scale));
    const snap = snapResize(toRect(old), toRect(next), targets, pageBounds(geom), SNAP_PX / scale);
    const corners = [[snap.rect.x, snap.rect.y], [snap.rect.x + snap.rect.w, snap.rect.y + snap.rect.h]].map((p) => toScreen(p as Pt, geom, scale));
    snapStore.getState().show({
      pageKey, guides: snap.guides, gaps: [],
      badge: { at: sizeBadge(snap.rect, geom, scale), text: `${fmtPt(snap.rect.w)} × ${fmtPt(snap.rect.h)}` },
    });
    return {
      ...next, x: Math.min(corners[0][0], corners[1][0]), y: Math.min(corners[0][1], corners[1][1]),
      width: Math.abs(corners[1][0] - corners[0][0]), height: Math.abs(corners[1][1] - corners[0][1]),
    };
  }

  // Dragging on the empty page (or on original text) selects what the marquee touches, live.
  const marquee = useMarquee(scale, pos, () => mine.filter((op) => !isDeletedText(op)).map((op) => ({ id: op.id, rect: boundsOf(op) })));
  useEffect(() => marquee.stop, [tool]); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (e.evt.button === 1) return; // the middle button pans the canvas (Editor), it draws nothing
    const s = editorStore.getState();
    if (tool === "select") {
      if (e.evt.button !== 0) return;
      const t = e.target, empty = t === t.getStage();
      // The empty page, or original text that is not being dragged (ParagraphLayer lets such a press through): a
      // click clears the selection (Delete must not remove an object the user sees as deselected), a drag is a marquee.
      if (empty || (TEXT_TARGETS.has(t.name()) && !t.draggable())) {
        if (empty && !e.evt.shiftKey) { s.select(null); textEditStore.getState().selectParagraph(null); }
        marquee.begin(pos(), e.evt.shiftKey);
      }
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
      onPointerLeave={() => altMeasure.leave()}
      style={{ pointerEvents: tool === "pan" || space ? "none" : "auto", cursor: tool === "select" ? "default" : MARKUP_TOOLS.has(tool) ? "text" : "crosshair" }}
    >
      <Stage
        ref={stageRef}
        width={size.width}
        height={size.height}
        onPointerDown={onDown}
        onPointerMove={(e) => { if (poly.active) poly.hover(pos()); altMeasure.move(e.evt.altKey); }}
        onDblClick={() => poly.doubleClick()}
        onContextMenu={onContextMenu}
      >
        <Layer>
          <Group ref={pageRef} x={tr.x} y={tr.y} rotation={tr.rotation} scaleX={tr.scale} scaleY={tr.scale} offsetX={tr.offsetX} offsetY={tr.offsetY}>
            {overlayHooks.renderUnder?.(pageKey, geom, scale)}
            {objs.map((op) => (
              <Group
                key={op.id}
                ref={(n) => { if (n) nodes.current.set(op.id, n); else nodes.current.delete(op.id); }}
                name="object"
                id={op.id}
                {...objectGroupAttrs(op)}
                draggable={tool === "select"}
                listening={tool === "select"}
                onPointerDown={(e) => { if (tool === "select") objectDrag.onPress(e, op.id); }}
                onPointerUp={() => objectDrag.onRelease(op.id)}
                onMouseEnter={(e) => { if (tool === "select") setCursor(e, "move"); }}
                onMouseLeave={(e) => setCursor(e, "")}
                onDragStart={(e) => objectDrag.onDragStart(e, op.id)}
                onDragMove={(e) => objectDrag.onDragMove(e, op.id)}
                onDragEnd={() => objectDrag.onDragEnd()}
                onTransformStart={() => { resizeTargets.current = null; }}
                // A text box re-wraps at every move of its handle (the Transformer only scales the group: it goes back to 1
                // each time, so the glyphs are never stretched). Chrome delivers the moves once per frame.
                onTransform={(e) => {
                  const g = e.currentTarget as Konva.Group;
                  const cur = editorStore.getState().doc.objects[op.id];
                  if (!cur || !isTextOp(cur) || cancelled.current) return;
                  const base = liveResizeStore.getState().live ?? cur;
                  const next = transformed(base, g, pageRef.current!) as TextOp;
                  flushSync(() => setLiveResize(next)); // the Transformer measures the group once this event is over
                  g.setAttrs({ ...objectGroupAttrs(next), scaleX: 1, scaleY: 1 });
                }}
                onTransformEnd={(e) => {
                  snapStore.getState().clear();
                  resizeTargets.current = null;
                  const g = e.currentTarget as Konva.Group;
                  const cur = editorStore.getState().doc.objects[op.id];
                  const live = liveResizeStore.getState().live;
                  setLiveResize(null);
                  // Escape: back to the saved op. Release: the last live frame (a non-text object: its scaled group).
                  const next = !cur || cancelled.current ? cur : live ?? transformed(cur, g, pageRef.current!);
                  cancelled.current = false;
                  g.setAttrs({ ...objectGroupAttrs(next ?? op), scaleX: 1, scaleY: 1 });
                  if (next && next !== cur) updateTextOp(op.id, next);
                }}
                onDblClick={() => overlayHooks.onDoubleClick?.(op)}
              >
                {isTextOp(op)
                  ? overlayHooks.renderText?.(op, selection === op.id) ?? null
                  : <ObjectShape op={op} docId={docId} />}
              </Group>
            ))}
            {draft && !isMarkup(draft) && <Group opacity={opacityOf(draft)}><ObjectShape op={draft} docId={docId} /></Group>}
            {picked.length > 1 && picked.map((op) => {
              const b = boundsOf(op);
              return <Rect key={`pick-${op.id}`} name="pick" x={b.x} y={b.y} width={b.w} height={b.h} stroke={CANVAS.accent} strokeWidth={1} strokeScaleEnabled={false} listening={false} />;
            })}
            {/* The group's box: the node its own Transformer (below) holds, to resize every member at once. */}
            {groupBox && (
              <Rect
                ref={groupRef} name="group-box" x={groupBox.x} y={groupBox.y} width={groupBox.w} height={groupBox.h} listening={false}
                onTransformEnd={(e) => {
                  const node = e.currentTarget;
                  const c = node.getClientRect({ relativeTo: pageRef.current!, skipStroke: true });
                  const to = { x: c.x, y: c.y, w: c.width, h: c.height };
                  node.setAttrs({ x: to.x, y: to.y, width: to.w, height: to.h, scaleX: 1, scaleY: 1 });
                  resizeGroup(picked.map((o) => o.id), groupBox, to, overlayHooks.resizeText);
                }}
              />
            )}
            {marquee.rect && (
              <Rect name="marquee" x={marquee.rect.x} y={marquee.rect.y} width={marquee.rect.w} height={marquee.rect.h}
                fill={CANVAS.marqueeFill} stroke={CANVAS.accent} strokeWidth={1} strokeScaleEnabled={false} listening={false} />
            )}
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
            boundBoxFunc={snapResizeBox}
            enabledAnchors={selection && isTextOp(objects[selection])
              ? ["middle-left", "middle-right"]
              : boxAnchors(selection ? objects[selection] : undefined, tr.scale)}
            borderStroke={CANVAS.accent}
            anchorStroke={CANVAS.accent}
            anchorSize={8}
          />
          {/* A group: handles around its box scale every member; text boxes by their width only. */}
          <Transformer
            ref={groupTrRef}
            rotateEnabled={false}
            flipEnabled={false}
            ignoreStroke
            keepRatio={false}
            enabledAnchors={groupBox ? boxAnchors({ type: "whiteout.add", rect: { x: 0, y: 0, w: groupBox.w, h: groupBox.h } } as unknown as ContentOp, tr.scale) : []}
            borderStroke={CANVAS.accent}
            anchorStroke={CANVAS.accent}
            anchorSize={8}
          />
        </Layer>
        <Layer ref={multiplyLayer} listening={tool === "select"}>
          <Group x={tr.x} y={tr.y} rotation={tr.rotation} scaleX={tr.scale} scaleY={tr.scale} offsetX={tr.offsetX} offsetY={tr.offsetY}>
            {markups.map((op) => (
              <Group key={op.id} name="object" id={op.id} onPointerDown={(e) => objectDrag.onPress(e, op.id)} onPointerUp={() => objectDrag.onRelease(op.id)}
              // The markup layer is above the text: a double-click edits the text under the markup.
              onDblClick={() => overlayHooks.onMarkupDoubleClick?.(pageKey, pos())}
              onDblTap={() => overlayHooks.onMarkupDoubleClick?.(pageKey, pos())}>
                <MarkupShape op={op} selected={selection === op.id} />
              </Group>
            ))}
            {draft && isMarkup(draft) && <MarkupShape op={draft} />}
          </Group>
        </Layer>
        <SnapGuides pageKey={pageKey} geom={geom} scale={scale} />
      </Stage>
    </div>
  );
}
