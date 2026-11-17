import { useEffect, useRef } from "react";
import { createStore } from "zustand/vanilla";

/** What the command palette asks of parts of the editor that keep their own state (a dialog's open flag, a file input):
 *  the part runs it when it hears it, or when it mounts while the request is still waiting (a dialog that only exists
 *  once its tool is chosen). */
export type UiCommand = "uploadImage" | "stamp" | "signature" | "managePages" | "autoRedact" | "download" | "openPdf";

interface Request { name: UiCommand; taken: boolean; at: number }

export const commandStore = createStore<{ request: Request | null; ask(name: UiCommand): void }>()((set) => ({
  request: null,
  ask: (name) => set({ request: { name, taken: false, at: Date.now() } }),
}));

/** A request not taken within this long is stale (its part never came). */
const WAIT_MS = 2000;

/** Runs `run` when `name` is asked. */
export function useCommand(name: UiCommand, run: () => void) {
  const latest = useRef(run);
  useEffect(() => { latest.current = run; });
  useEffect(() => {
    const take = () => {
      const r = commandStore.getState().request;
      if (!r || r.taken || r.name !== name || Date.now() - r.at > WAIT_MS) return;
      r.taken = true;
      latest.current();
    };
    take();
    return commandStore.subscribe(take);
  }, [name]);
}
