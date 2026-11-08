import { t } from "@/lib/strings";
import type { Tool } from "@/store/editor";

/** One-letter tool shortcuts (no modifier, outside text fields), shown in the tooltips. */
export const TOOL_KEYS = {
  select: "V", pan: "H", text: "T", whiteout: "E", highlight: "M", ink: "P", rect: "R", ellipse: "O", line: "L",
} as const satisfies Partial<Record<Tool, string>>;

const BY_KEY = new Map<string, Tool>(Object.entries(TOOL_KEYS).map(([tool, k]) => [k, tool as Tool]));

export function toolForKey(e: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean }): Tool | null {
  if (e.metaKey || e.ctrlKey || e.altKey || e.key.length !== 1) return null;
  return BY_KEY.get(e.key.toUpperCase()) ?? null;
}

export function toolKey(tool: Tool): string | undefined {
  return (TOOL_KEYS as Partial<Record<Tool, string>>)[tool];
}

/** The one-line hint shown while `tool` is active; none for Pilih and for the hidden note and link tools. */
export function toolHint(tool: Tool): string | null {
  switch (tool) {
    case "select": case "note": case "link": case "image": return null;
    case "polygon": case "polyline": case "cloud": return t.hints.points;
    default: return t.hints[tool];
  }
}
