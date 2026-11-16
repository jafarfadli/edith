"use client";

import { useRef } from "react";

/** "Edit" set in dots, like a dot-matrix print: two dots per stroke on a 10-unit grid, 11 rows high (the "d" and "t"
 *  rise above the x-height, the "i" carries its dot in the accent). The dots pop in from left to right; under a mouse
 *  pointer the ones nearby swell, as under a loupe (the distance is worked out in CSS from --mx/--my). */

const GLYPHS: string[][] = [
  [".######", "#######", "##.....", "##.....", "######.", "######.", "##.....", "##.....", "##.....", "#######", ".######"],
  [".....##", ".....##", ".....##", "..#####", ".######", "##...##", "##...##", "##...##", "##...##", ".######", "..#####"],
  ["@@", "@@", "..", "##", "##", "##", "##", "##", "##", "##", "##"],
  ["......", ".##...", ".##...", "######", "######", ".##...", ".##...", ".##...", ".##...", ".#####", "..####"],
];

const PITCH = 10;
const GAP = 2;

interface Dot { x: number; y: number; accent: boolean; delay: number }

const DOTS: Dot[] = (() => {
  const out: Dot[] = [];
  let col = 0;
  for (const rows of GLYPHS) {
    rows.forEach((row, r) => [...row].forEach((c, k) => {
      if (c === ".") return;
      const x = (col + k) * PITCH + PITCH / 2;
      const y = r * PITCH + PITCH / 2;
      // Left to right with a little scatter, the same on the server and in the browser; the i's dot lands last.
      const jitter = ((out.length * 73) % 97) / 97;
      out.push({ x, y, accent: c === "@", delay: c === "@" ? 900 : Math.round((col + k) * 16 + jitter * 220) });
    }));
    col += rows[0].length + GAP;
  }
  return out;
})();

const WIDTH = (GLYPHS.reduce((n, g) => n + g[0].length, 0) + GAP * (GLYPHS.length - 1)) * PITCH;
const HEIGHT = GLYPHS[0].length * PITCH;

export function DotWord({ className }: { className?: string }) {
  const svg = useRef<SVGSVGElement>(null);

  function move(e: React.PointerEvent<SVGSVGElement>) {
    if (e.pointerType !== "mouse" || !svg.current) return;
    const box = svg.current.getBoundingClientRect();
    svg.current.style.setProperty("--mx", String(((e.clientX - box.left) / box.width) * WIDTH));
    svg.current.style.setProperty("--my", String(((e.clientY - box.top) / box.height) * HEIGHT));
  }
  function leave() {
    svg.current?.style.setProperty("--mx", "-999");
    svg.current?.style.setProperty("--my", "-999");
  }

  return (
    <svg ref={svg} viewBox={`-6 -6 ${WIDTH + 12} ${HEIGHT + 12}`} aria-hidden onPointerMove={move} onPointerLeave={leave}
      className={`dot-word overflow-visible ${className ?? ""}`}>
      {DOTS.map((d, i) => (
        <circle key={i} cx={d.x} cy={d.y} r={4.2} fill={d.accent ? "var(--accent)" : "var(--ink)"}
          style={{ "--x": d.x, "--y": d.y, animationDelay: `${d.delay}ms` } as React.CSSProperties} />
      ))}
    </svg>
  );
}
