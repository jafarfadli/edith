"use client";

import { Arrow, Ellipse, Image as KImage, Line, Rect, Shape } from "react-konva";
import type { ContentOp, Rect as R } from "@edith/ops";
import { cloudBeziers, dashPattern, type Dash, type Pt } from "@/lib/geometry";
import { arrowHead, NOTE_SIZE } from "@/lib/objects";
import { symbolPaths } from "@/lib/symbols";
import { MarkupShape } from "./marks/MarkupShape";
import { StampNode } from "./marks/StampNode";
import { useImageAsset } from "./useImageAsset";

const LINK_COLOR = "#2563eb";

/** MuPDF's Note icon: a filled square with a 1 pt black border and four 8 x 1 pt black lines. */
function NoteIcon({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <>
      <Rect x={x + 0.5} y={y + 0.5} width={NOTE_SIZE - 1} height={NOTE_SIZE - 1} fill={color} stroke="#000000" strokeWidth={1} />
      {[4, 6, 8, 10].map((dy) => <Rect key={dy} x={x + 4} y={y + dy} width={8} height={1} fill="#000000" listening={false} />)}
    </>
  );
}

function ImageObject({ docId, assetId, rect }: { docId: string; assetId: string; rect: R }) {
  const img = useImageAsset(docId, assetId);
  return img
    ? <KImage image={img} x={rect.x} y={rect.y} width={rect.w} height={rect.h} />
    : <Rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} fill="#e3e6eb" />;
}

/** A cloud: its scalloped border (shared geometry with the bake) as one closed Bézier path. */
function Cloud({ points, width, stroke, fill, dash }: { points: Pt[]; width: number; stroke?: string; fill?: string; dash: ReturnType<typeof dashPattern> }) {
  const arcs = cloudBeziers(points, width);
  return (
    <Shape
      sceneFunc={(ctx, shape) => {
        ctx.beginPath();
        if (arcs.length) ctx.moveTo(arcs[0][0][0], arcs[0][0][1]);
        for (const [, c1, c2, p] of arcs) ctx.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], p[0], p[1]);
        ctx.closePath();
        ctx.fillStrokeShape(shape);
      }}
      stroke={stroke} strokeWidth={width} fill={fill} lineJoin="round" lineCap={dash?.lineCap ?? "round"} dash={dash?.dash} hitStrokeWidth={Math.max(width, 8)}
    />
  );
}

export function ObjectShape({ op, docId }: { op: ContentOp; docId: string }) {
  const o = op as ContentOp & Record<string, unknown>;
  switch (op.type) {
    case "whiteout.add": {
      const r = o.rect as R;
      return <Rect x={r.x} y={r.y} width={r.w} height={r.h} fill="#ffffff" />;
    }
    case "redact.add": {
      const r = o.rect as R;
      return <Rect x={r.x} y={r.y} width={r.w} height={r.h} fill={o.fill === "white" ? "#ffffff" : "#000000"} opacity={0.75} stroke="#c2410c" strokeWidth={1} dash={[4, 3]} strokeScaleEnabled={false} />;
    }
    case "image.add": case "signature.add":
      return <ImageObject docId={docId} assetId={o.assetId as string} rect={o.rect as R} />;
    case "stamp.add":
      return <StampNode op={op} />;
    case "symbol.add": {
      const { paths, width } = symbolPaths(op.kind, op.rect);
      return <>
        <Rect x={op.rect.x} y={op.rect.y} width={op.rect.w} height={op.rect.h} fill="transparent" />
        {paths.map((p, i) => <Line key={i} points={p.flat()} stroke={op.color} strokeWidth={width} lineCap="round" lineJoin="round" listening={false} />)}
      </>;
    }
    case "link.add": {
      const r = op.rect;
      // Links have no appearance in the PDF; on screen a light dashed box shows the click area.
      return <Rect x={r.x} y={r.y} width={r.w} height={r.h} fill="rgba(37,99,235,0.08)" stroke={LINK_COLOR} strokeWidth={1} dash={[4, 3]} strokeScaleEnabled={false} />;
    }
    case "annot.add": {
      if (op.kind !== "note") return <MarkupShape op={op} />;
      const [x, y] = op.point ?? [0, 0];
      return <NoteIcon x={x} y={y} color={op.color} />;
    }
    case "ink.add":
      return <>{(o.paths as number[][][]).map((path, i) =>
        path.length === 1
          ? <Ellipse key={i} x={path[0][0]} y={path[0][1]} radiusX={(o.width as number) / 2} radiusY={(o.width as number) / 2} fill={o.color as string} />
          : <Line key={i} points={path.flat()} stroke={o.color as string} strokeWidth={o.width as number} lineCap="round" lineJoin="round" hitStrokeWidth={12} />,
      )}</>;
    case "shape.add": {
      const stroke = o.stroke as string, width = o.width as number, fill = (o.fill as string | null) ?? undefined;
      const d = dashPattern(o.dash as Dash | undefined, width);
      const dashProps = d ? { dash: d.dash, lineCap: d.lineCap } : {};
      if (o.kind === "rect") { const r = o.rect as R; return <Rect x={r.x} y={r.y} width={r.w} height={r.h} stroke={width > 0 ? stroke : undefined} strokeWidth={width} fill={fill} hitStrokeWidth={Math.max(width, 8)} {...dashProps} />; }
      if (o.kind === "ellipse") { const r = o.rect as R; return <Ellipse x={r.x + r.w / 2} y={r.y + r.h / 2} radiusX={r.w / 2} radiusY={r.h / 2} stroke={width > 0 ? stroke : undefined} strokeWidth={width} fill={fill} hitStrokeWidth={Math.max(width, 8)} {...dashProps} />; }
      if (o.kind === "cloud") return <Cloud points={o.points as Pt[]} width={width} stroke={width > 0 ? stroke : undefined} fill={fill} dash={d} />;
      const pts = (o.points as number[][]).flat();
      if (o.kind === "polygon" || o.kind === "polyline") {
        const closed = o.kind === "polygon";
        return <Line points={pts} closed={closed} stroke={width > 0 ? stroke : undefined} strokeWidth={width} fill={closed ? fill : undefined}
          lineJoin="round" lineCap="round" hitStrokeWidth={Math.max(width, 8)} {...dashProps} />;
      }
      if (o.kind === "arrow") { const h = arrowHead(width); return <Arrow points={pts} stroke={stroke} fill={stroke} strokeWidth={Math.max(width, 0.5)} lineCap="round" pointerLength={h.length} pointerWidth={h.width} hitStrokeWidth={12} {...dashProps} />; }
      return <Line points={pts} stroke={stroke} strokeWidth={Math.max(width, 0.5)} lineCap="round" hitStrokeWidth={12} {...dashProps} />;
    }
    default:
      return null;
  }
}
