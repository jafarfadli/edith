"use client";

import { Arrow, Ellipse, Image as KImage, Line, Rect } from "react-konva";
import type { ContentOp, Rect as R } from "@edith/ops";
import { arrowHead } from "@/lib/objects";
import { useImageAsset } from "./useImageAsset";

function ImageObject({ docId, assetId, rect }: { docId: string; assetId: string; rect: R }) {
  const img = useImageAsset(docId, assetId);
  return img
    ? <KImage image={img} x={rect.x} y={rect.y} width={rect.w} height={rect.h} />
    : <Rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} fill="#e3e6eb" />;
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
    case "image.add":
      return <ImageObject docId={docId} assetId={o.assetId as string} rect={o.rect as R} />;
    case "ink.add":
      return <>{(o.paths as number[][][]).map((path, i) =>
        path.length === 1
          ? <Ellipse key={i} x={path[0][0]} y={path[0][1]} radiusX={(o.width as number) / 2} radiusY={(o.width as number) / 2} fill={o.color as string} />
          : <Line key={i} points={path.flat()} stroke={o.color as string} strokeWidth={o.width as number} lineCap="round" lineJoin="round" hitStrokeWidth={12} />,
      )}</>;
    case "shape.add": {
      const stroke = o.stroke as string, width = o.width as number, fill = (o.fill as string | null) ?? undefined;
      if (o.kind === "rect") { const r = o.rect as R; return <Rect x={r.x} y={r.y} width={r.w} height={r.h} stroke={width > 0 ? stroke : undefined} strokeWidth={width} fill={fill} />; }
      if (o.kind === "ellipse") { const r = o.rect as R; return <Ellipse x={r.x + r.w / 2} y={r.y + r.h / 2} radiusX={r.w / 2} radiusY={r.h / 2} stroke={width > 0 ? stroke : undefined} strokeWidth={width} fill={fill} />; }
      const pts = (o.points as number[][]).flat();
      if (o.kind === "arrow") { const h = arrowHead(width); return <Arrow points={pts} stroke={stroke} fill={stroke} strokeWidth={Math.max(width, 0.5)} lineCap="round" pointerLength={h.length} pointerWidth={h.width} hitStrokeWidth={12} />; }
      return <Line points={pts} stroke={stroke} strokeWidth={Math.max(width, 0.5)} lineCap="round" hitStrokeWidth={12} />;
    }
    default:
      return null;
  }
}
