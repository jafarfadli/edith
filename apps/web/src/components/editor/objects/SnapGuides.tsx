"use client";

import { Group, Label, Layer, Line, Tag, Text } from "react-konva";
import { useStore } from "zustand";
import { toScreen, type PageGeom, type Pt } from "@/lib/coords";
import { fmtPt } from "@/lib/snap";
import { CANVAS } from "@/lib/theme";
import { snapStore } from "@/store/snap";

const FONT = "Geist, system-ui, sans-serif";
/** Length (px) of the little bars that close a gap line. */
const TICK = 3;

function Pill({ at, text, fill }: { at: Pt; text: string; fill: string }) {
  return (
    <Label x={at[0]} y={at[1]} listening={false}>
      <Tag fill={fill} cornerRadius={3} pointerDirection="none" />
      <Text text={text} fontSize={10} fontFamily={FONT} fill="#ffffff" padding={3} />
    </Label>
  );
}

/** The smart guides, spacing gaps with their lengths, and the size badge of the page's drag or resize in progress
 *  (snapStore), drawn in screen pixels over the objects. It is its own layer and subscribes by itself, so a drag
 *  redraws only this and not the page's objects. */
export function SnapGuides({ pageKey, geom, scale }: { pageKey: string; geom: PageGeom; scale: number }) {
  const view = useStore(snapStore, (s) => (s.view?.pageKey === pageKey ? s.view : null));
  if (!view) return null;
  const px = (x: number, y: number) => toScreen([x, y], geom, scale);
  return (
    <Layer listening={false} name="snap-guides">
      {view.guides.map((g) => {
        const a = g.axis === "x" ? px(g.pos, g.from) : px(g.from, g.pos), b = g.axis === "x" ? px(g.pos, g.to) : px(g.to, g.pos);
        return <Line key={`${g.axis}${g.pos}`} name="guide" points={[a[0], a[1], b[0], b[1]]} stroke={CANVAS.guide} strokeWidth={1} />;
      })}
      {view.gaps.map((g) => {
        const a = g.axis === "x" ? px(g.from, g.at) : px(g.at, g.from), b = g.axis === "x" ? px(g.to, g.at) : px(g.at, g.to);
        // The bars that close the gap run across it, whichever way the page is turned.
        const across = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]) ? [0, TICK] : [TICK, 0];
        const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        return (
          <Group key={`${g.axis}${g.from}${g.to}${g.at}`} name="gap" listening={false}>
            <Line points={[a[0], a[1], b[0], b[1]]} stroke={CANVAS.guide} strokeWidth={1} />
            <Line points={[a[0] - across[0], a[1] - across[1], a[0] + across[0], a[1] + across[1]]} stroke={CANVAS.guide} strokeWidth={1} />
            <Line points={[b[0] - across[0], b[1] - across[1], b[0] + across[0], b[1] + across[1]]} stroke={CANVAS.guide} strokeWidth={1} />
            <Pill at={[mid[0] - 8, mid[1] - 8]} text={fmtPt(g.to - g.from)} fill={CANVAS.guide} />
          </Group>
        );
      })}
      {view.badge && <Pill at={[view.badge.at[0] - 24, view.badge.at[1] + 8]} text={view.badge.text} fill={CANVAS.accent} />}
    </Layer>
  );
}
