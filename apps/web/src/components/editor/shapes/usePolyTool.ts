"use client";

import { useEffect, useState } from "react";
import type { ShapeAdd } from "@edith/ops";
import { newId } from "@/lib/id";
import { polyClick, polyDoubleClick, polyFromPoints, type PolyTool, type Pt } from "@/lib/objects";
import { editorStore } from "@/store/editor";

/** The polygon/polyline/cloud tool on one page: each click adds a vertex; a double-click (two clicks on the same
 *  spot), Enter or a click on the first vertex finishes (then back to Pilih with the shape selected, like the other
 *  shape tools); Escape cancels. `preview` is the shape drawn so far, up to the pointer. */
export function usePolyTool(pageKey: string, tool: PolyTool | null, scale: number) {
  // The vertices belong to the tool they were clicked with: switching tools drops them.
  const [state, setState] = useState<{ tool: PolyTool | null; points: Pt[]; hover: Pt | null }>({ tool: null, points: [], hover: null });
  const points = state.tool === tool ? state.points : [];
  const hover = state.tool === tool ? state.hover : null;
  const reset = () => setState({ tool, points: [], hover: null });

  function finish(pts: Pt[] = points) {
    if (!tool) return;
    const op = polyFromPoints(tool, pts, editorStore.getState().style, pageKey, newId());
    reset();
    if (!op) return;
    const s = editorStore.getState();
    s.addObject(op);
    s.setTool("select");
    s.select(op.id);
  }

  function click(at: Pt) {
    if (!tool) return;
    const r = polyClick(tool, points, at, scale);
    if (r.finish) finish(r.points);
    else setState({ tool, points: r.points, hover: null });
  }

  const active = !!tool && points.length > 0;
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") { e.preventDefault(); finish(); }
      else if (e.key === "Escape") reset();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  let preview: ShapeAdd | null = null;
  if (active) {
    const pts = hover ? [...points, hover] : points;
    const kind: PolyTool = tool === "polyline" || pts.length < 3 ? "polyline" : tool!;
    const style = editorStore.getState().style;
    preview = polyFromPoints(kind, pts.length === 1 ? [pts[0], [pts[0][0] + 0.5, pts[0][1]]] : pts, style, pageKey, "draft");
  }

  /** Konva reports two quick clicks anywhere as a double-click: only two on the same spot finish the shape. */
  function doubleClick() {
    const rest = polyDoubleClick(points, scale);
    if (rest) finish(rest);
  }

  return {
    active, preview, click, finish: () => finish(), doubleClick,
    hover: (at: Pt) => setState((s) => (s.tool === tool && s.points.length ? { ...s, hover: at } : s)),
  };
}
