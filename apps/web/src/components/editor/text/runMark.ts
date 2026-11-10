import { Mark } from "@tiptap/core";
import type { FontRef } from "@edith/ops";
import { runCss, type RunAttrs } from "@/lib/richtext";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    run: {
      /** Restyles every text in the selection with `fn` (or the style typed next, when the selection is empty), given
       *  each piece's text ("" for the style typed next). */
      updateRuns: (fn: (a: RunAttrs, text: string) => RunAttrs) => ReturnType;
    };
  }
}

const KEYS = ["font", "size", "color", "bgColor", "underline", "strike", "hScale", "charSpacing", "wordSpacing",
  "underlineTop", "strikeTop", "decorThickness", "decorColor"] as const;

function readRun(el: HTMLElement): Partial<RunAttrs> {
  try { return JSON.parse(el.getAttribute("data-run") || "{}") as Partial<RunAttrs>; } catch { return {}; }
}

/** The one mark of the rich editor: a run's whole character style. `fallback` styles text that has none yet;
 *  `standIn(font)`: the font that draws what an original font lacks (its bundled substitute), shown after it. */
export function createRunMark(fallback: () => RunAttrs, standIn: (f: FontRef) => FontRef | null = () => null) {
  return Mark.create({
    name: "run",
    inclusive: true,
    addAttributes() {
      const defaults: Record<(typeof KEYS)[number], unknown> = {
        font: { kind: "bundled", family: "Arimo", bold: false, italic: false }, size: 12, color: "#000000", bgColor: null,
        underline: false, strike: false, hScale: 1, charSpacing: 0, wordSpacing: 0,
        underlineTop: null, strikeTop: null, decorThickness: null, decorColor: null,
      };
      return Object.fromEntries(KEYS.map((k) => [k, {
        default: defaults[k],
        rendered: false,
        parseHTML: (el: HTMLElement) => readRun(el)[k] ?? defaults[k],
      }]));
    },
    // Copy/paste inside the editor keeps styles: the attributes travel as JSON in data-run.
    parseHTML() { return [{ tag: "span[data-run]" }]; },
    renderHTML({ mark }) {
      const a = mark.attrs as RunAttrs;
      return ["span", { "data-run": JSON.stringify(a), style: runCss(a, standIn(a.font)) }, 0];
    },
    addCommands() {
      return {
        updateRuns: (fn) => ({ state, tr, dispatch }) => {
          const type = state.schema.marks.run;
          const { from, to, empty } = state.selection;
          if (!dispatch) return true;
          if (empty) {
            const marks = state.storedMarks ?? state.selection.$from.marks();
            const cur = marks.find((m) => m.type === type)?.attrs as RunAttrs | undefined;
            tr.addStoredMark(type.create(fn(cur ?? fallback(), "")));
            return true;
          }
          state.doc.nodesBetween(from, to, (node, pos) => {
            if (!node.isText) return;
            const cur = node.marks.find((m) => m.type === type)?.attrs as RunAttrs | undefined;
            const a = Math.max(from, pos), b = Math.min(to, pos + node.nodeSize);
            tr.addMark(a, b, type.create(fn(cur ?? fallback(), node.text!.slice(a - pos, b - pos))));
          });
          return true;
        },
      };
    },
  });
}
