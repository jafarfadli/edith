"use client";

import { screenSize, type PageGeom } from "@/lib/coords";
import type { PageEntry } from "@/store/editor";
import { PageCanvas } from "./PageCanvas";

export const THUMB_W = 120;

export function Thumbnail({ entry, geom, width = THUMB_W }: { entry: PageEntry; geom: PageGeom; width?: number }) {
  const scale = width / screenSize(geom, 1).width;
  const size = screenSize(geom, scale);
  return (
    <div className="relative overflow-hidden bg-paper shadow-page" style={{ width: size.width, height: size.height }}>
      <PageCanvas entry={entry} geom={geom} scale={scale} label="thumbnail" />
    </div>
  );
}
