"use client";

import { useEffect, type RefObject } from "react";
import { moveIndex, type Orientation } from "@/lib/rovingFocus";

/** Keyboard for a popup (menu, colour popover) that renders in a portal at the end of <body>, where Tab cannot reach
 *  it: on open, focus goes to its first item (when `focusOnOpen`); arrows (see `orientation`), Home and End move
 *  between the items; Enter/Space press them (they are buttons); Escape closes and puts focus back on the trigger;
 *  Tab closes and moves on from the trigger, as if the popup had sat next to it. Returns the popup's onKeyDown. */
export function usePopupFocus({ open, popup, trigger, items, orientation, focusOnOpen = true, close }: {
  open: boolean;
  popup: RefObject<HTMLElement | null>;
  trigger: RefObject<HTMLElement | null>;
  /** Selector of the items inside the popup. */
  items: string;
  orientation: Orientation;
  focusOnOpen?: boolean;
  close: () => void;
}) {
  useEffect(() => {
    if (open && focusOnOpen) popup.current?.querySelector<HTMLElement>(items)?.focus();
  }, [open, focusOnOpen, popup, items]);

  return (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation(); // not the editor's Escape (back to Pilih)
      close();
      trigger.current?.focus();
      return;
    }
    if (e.key === "Tab") {
      // Focus the trigger now; the browser's own Tab then moves on from there (no preventDefault).
      close();
      trigger.current?.focus();
      return;
    }
    const list = [...(popup.current?.querySelectorAll<HTMLElement>(items) ?? [])];
    const at = moveIndex(e.key, list.indexOf(document.activeElement as HTMLElement), list.length, orientation);
    if (at === null) return;
    e.preventDefault(); // no page scroll
    e.stopPropagation(); // not the editor's arrow-key nudge of the selected object
    list[at].focus();
  };
}

/** Closing a popup by picking an item: focus goes back to the trigger when it was inside the popup (keyboard use);
 *  a mouse pick that never moved focus (the rich-text editor keeps it) leaves it where it is. */
export function returnFocus(popup: RefObject<HTMLElement | null>, trigger: RefObject<HTMLElement | null>): void {
  if (popup.current?.contains(document.activeElement)) trigger.current?.focus();
}
