"use client";

import { Rect } from "react-konva";
import { useStore } from "zustand";
import { fontStore } from "@/lib/fonts";
import { highlightRects } from "@/lib/targets";
import { useEditor } from "@/store/editor";
import { useText } from "@/store/text";
import { findStore } from "./findStore";

/** Find matches on one page: all in yellow, the current one in orange. */
export function MatchHighlights({ pageKey }: { pageKey: string }) {
  const open = useStore(findStore, (s) => s.open);
  const matches = useStore(findStore, (s) => s.matches);
  const current = useStore(findStore, (s) => s.current);
  useStore(findStore, (s) => s.fontsVersion); // re-measure once fonts loaded
  const doc = useEditor((s) => s.doc);
  const pages = useText((s) => s.pages);
  const fonts = useText((s) => s.fonts);
  if (!open) return null;
  return (
    <>
      {matches.flatMap((m, i) => (m.pageKey !== pageKey ? [] : highlightRects(m, doc, pages, fonts, (f) => fontStore.peek(f)).map((r, k) => (
        <Rect key={`${i}-${k}`} x={r.x} y={r.y} width={r.w} height={r.h} listening={false}
          fill={i === current ? "#f97316" : "#facc15"} opacity={0.4} />
      ))))}
    </>
  );
}
