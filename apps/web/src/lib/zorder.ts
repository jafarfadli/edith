import type { ContentOp, Rect } from "@edith/ops";
import { visualBounds } from "@/lib/objects";

/** Stacking (z-order) of the objects of a page: their position in `doc.order`, lowest first.
 *
 *  The bake draws a page in fixed stages (apps/api/edith/bake/__init__.py, registry.PHASE): redactions are applied
 *  first, then every drawn object (whiteout, shapes, ink, text, images, signatures, stamps, symbols) in `order`, then
 *  native annotations (highlight, underline, strike, notes) in `order`, then links. Order therefore only matters
 *  between objects of the same page and the same stage: reordering swaps an object with those "peers" only, and the
 *  canvas stacks a page's objects by stage first (see `stacked`) so it shows what the export draws. */
export type ZStage = "redact" | "draw" | "annot" | "link";
export type ZMove = "front" | "forward" | "backward" | "back";

const STAGE_RANK: Record<ZStage, number> = { redact: 0, draw: 1, annot: 2, link: 3 };

/** The bake stage of `op` (shared contract with registry.PHASE in the API). */
export function zStage(op: ContentOp): ZStage {
  switch (op.type) {
    case "redact.add": return "redact";
    case "annot.add": return "annot";
    case "link.add": return "link";
    default: return "draw";
  }
}

/** `ops` (in `doc.order`) as the export stacks them, lowest first: by stage, then by order (stable). */
export function stacked<T extends ContentOp>(ops: T[]): T[] {
  return ops.map((op, i) => ({ op, i })).sort((a, b) => STAGE_RANK[zStage(a.op)] - STAGE_RANK[zStage(b.op)] || a.i - b.i).map((x) => x.op);
}

type Doc = { order: string[]; objects: Record<string, ContentOp | undefined> };

const classOf = (op: ContentOp) => `${op.pageKey}\u0000${zStage(op)}`;

/** Whether two objects' boxes (as shown: rotation included) meet; edges touching count, so a straight line (a box
 *  without height) still overlaps what it crosses. */
export function overlaps(a: ContentOp, b: ContentOp): boolean {
  const r = norm(visualBounds(a)), s = norm(visualBounds(b));
  return r.x <= s.x + s.w && s.x <= r.x + r.w && r.y <= s.y + s.h && s.y <= r.y + r.h;
}

function norm(r: Rect): Rect {
  return { x: Math.min(r.x, r.x + r.w), y: Math.min(r.y, r.y + r.h), w: Math.abs(r.w), h: Math.abs(r.h) };
}

/** One stacking step of the peers `ids` (lowest first) where `sel` are the moved ones; selected objects keep their
 *  relative order. Front/back: the whole selection to the end of the stack. Forward/backward (as in Figma or Canva):
 *  each selected object jumps past the nearest unselected peer above/below it that it overlaps, passing the
 *  objects in between that it does not touch (moving past those would change nothing visible); it never passes
 *  another selected object, and stays where it is when nothing it overlaps lies in that direction. */
function step(ids: string[], sel: ReadonlySet<string>, move: ZMove, hits: (a: string, b: string) => boolean): string[] {
  switch (move) {
    case "front": return [...ids.filter((id) => !sel.has(id)), ...ids.filter((id) => sel.has(id))];
    case "back": return [...ids.filter((id) => sel.has(id)), ...ids.filter((id) => !sel.has(id))];
    case "forward": case "backward": {
      const out = [...ids];
      const up = move === "forward";
      // The object nearest the moving end goes first, so the ones behind it see where it went.
      const moving = out.filter((id) => sel.has(id));
      if (up) moving.reverse();
      for (const id of moving) {
        const i = out.indexOf(id);
        let target = -1;
        for (let j = up ? i + 1 : i - 1; j >= 0 && j < out.length && !sel.has(out[j]); j += up ? 1 : -1) {
          if (hits(id, out[j])) { target = j; break; }
        }
        if (target < 0) continue;
        out.splice(i, 1);
        // Forward: the removal shifted the overlapped object to target - 1, so `target` is just above it; backward:
        // it is still at `target`, so inserting there puts the moved object just below it.
        out.splice(target, 0, id);
      }
      return out;
    }
  }
}

/** The new `doc.order` after moving the objects `ids` one step (past the next object they overlap) or to the end of
 *  their stack, or null when nothing changes (already at the front/back, nothing overlapping in that direction,
 *  unknown ids). Each object moves among its peers only (same
 *  page, same stage); the slots those peers occupy in the global order stay the same, so objects of other pages and
 *  stages keep their places. A selection spanning several pages or stages moves within each of them. */
export function reorder(doc: Doc, ids: readonly string[], move: ZMove): string[] | null {
  const sel = new Set(ids.filter((id) => doc.objects[id]));
  if (!sel.size) return null;
  const classes = new Set([...sel].map((id) => classOf(doc.objects[id]!)));
  const order = [...doc.order];
  let changed = false;
  for (const cls of classes) {
    const slots: number[] = [];
    order.forEach((id, i) => { const op = doc.objects[id]; if (op && classOf(op) === cls) slots.push(i); });
    const peers = slots.map((i) => order[i]);
    const next = step(peers, sel, move, (a, b) => overlaps(doc.objects[a]!, doc.objects[b]!));
    next.forEach((id, k) => { if (order[slots[k]] !== id) { order[slots[k]] = id; changed = true; } });
  }
  return changed ? order : null;
}

/** Whether each move would change anything for `ids` (the menus' disabled states). */
export function zMoves(doc: Doc, ids: readonly string[]): Record<ZMove, boolean> {
  return {
    front: reorder(doc, ids, "front") !== null,
    forward: reorder(doc, ids, "forward") !== null,
    backward: reorder(doc, ids, "backward") !== null,
    back: reorder(doc, ids, "back") !== null,
  };
}

/** Alt+click: the object to select among `stack` (the objects under the pointer, topmost first) — the one beneath
 *  `current`, wrapping round to the top; when `current` is not under the pointer, the one beneath the topmost. */
export function nextBelow(stack: readonly string[], current: string | null): string | null {
  if (!stack.length) return null;
  const i = current === null ? -1 : stack.indexOf(current);
  return stack[((i < 0 ? 0 : i) + 1) % stack.length];
}

/** Keyboard shortcuts of the moves (formatKeys / Kbd notation). */
export const Z_KEYS: Record<ZMove, string> = { front: "Mod+Shift+]", forward: "Mod+]", backward: "Mod+[", back: "Mod+Shift+[" };

/** The move of a key press (Ctrl/Cmd + [ or ], with Shift to the end; Shift+] types "}" on a US layout), or null.
 *  By the character, not `e.code`: on a German layout the BracketRight key is "+", and Ctrl/Cmd + "+" must stay the
 *  browser's zoom. */
export function zMoveForKey(e: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }): ZMove | null {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return null;
  const right = e.key === "]" || e.key === "}";
  const left = e.key === "[" || e.key === "{";
  if (right) return e.shiftKey ? "front" : "forward";
  if (left) return e.shiftKey ? "back" : "backward";
  return null;
}
