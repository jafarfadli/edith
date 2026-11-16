"use client";

import type { LucideIcon } from "lucide-react";
import type { Icon as EdithIcon } from "../brand/icons";
import { ariaKeys } from "@/lib/keys";
import { ICON } from "./icon";
import { Tip } from "./Tooltip";
import { useIsMac } from "./useIsMac";

export type AnyIcon = LucideIcon | EdithIcon;

/** A tool on the rail: its icon over its short name, the tooltip beside the rail. */
export const RAIL_BUTTON = "flex w-[3.75rem] shrink-0 flex-col items-center gap-1 rounded-lg px-0.5 pb-1.5 pt-2 transition-colors disabled:pointer-events-none disabled:text-faint/60";
export const railTone = (on: boolean | undefined) => on ? "bg-accent/15 text-accent-text" : "text-muted hover:bg-hover hover:text-ink";
export const RAIL_CAPTION = "font-condensed max-w-full text-center text-[0.6875rem] font-medium leading-[0.8125rem]";

/** A square icon button with a tooltip; `pressed` marks the active tool. With a `caption` it is a rail button. */
export function IconButton({ label, icon: Icon, keys, pressed, disabled, onClick, caption }: {
  label: string; icon: AnyIcon; keys?: string; pressed?: boolean; disabled?: boolean; onClick: () => void; caption?: string;
}) {
  const mac = useIsMac();
  if (caption) {
    return (
      <Tip label={label} keys={keys} side="rail">
        <button aria-label={label} aria-pressed={pressed} aria-keyshortcuts={keys && ariaKeys(keys, mac)} disabled={disabled} onClick={onClick}
          className={`${RAIL_BUTTON} ${railTone(pressed)}`}>
          <Icon size={20} strokeWidth={1.6} aria-hidden />
          <span aria-hidden className={RAIL_CAPTION}>{caption}</span>
        </button>
      </Tip>
    );
  }
  return (
    <Tip label={label} keys={keys}>
      <button aria-label={label} aria-pressed={pressed} aria-keyshortcuts={keys && ariaKeys(keys, mac)} disabled={disabled} onClick={onClick}
        className={`grid h-8 w-8 shrink-0 place-items-center rounded-md transition-colors disabled:pointer-events-none disabled:text-faint/60 ${pressed ? "bg-accent/20 text-accent-text" : "text-muted hover:bg-hover hover:text-ink"}`}>
        <Icon {...ICON} />
      </button>
    </Tip>
  );
}
