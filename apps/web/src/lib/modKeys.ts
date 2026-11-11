/** Whether Cmd or Ctrl is held right now, for gestures whose library gives no event (the Transformer's resize calls a
 *  plain function): tracked from the window's key events. Cmd/Ctrl turns smart-guide snapping off. */
let down = false;
let installed = false;

export function modHeld(): boolean {
  if (!installed && typeof window !== "undefined") {
    installed = true;
    const set = (e: KeyboardEvent) => { down = e.metaKey || e.ctrlKey; };
    window.addEventListener("keydown", set, true);
    window.addEventListener("keyup", set, true);
    window.addEventListener("blur", () => { down = false; });
  }
  return down;
}
