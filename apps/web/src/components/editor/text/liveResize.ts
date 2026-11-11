import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { TextOp } from "@/lib/objects";

/** The text op being resized with its handles, laid out again for the width the pointer is at. The document keeps the
 *  op as it was until release (one undo step); TextNode draws this one meanwhile, so the text re-wraps live instead
 *  of being stretched with the Transformer's box. */
export const liveResizeStore = createStore<{ live: TextOp | null }>()(() => ({ live: null }));

export const setLiveResize = (op: TextOp | null) => liveResizeStore.setState({ live: op });

/** The op to draw for `op`: its live resize frame, when it is being resized. */
export function useLiveText(op: TextOp): TextOp {
  const live = useStore(liveResizeStore, (s) => (s.live?.id === op.id ? s.live : null));
  return live ?? op;
}
