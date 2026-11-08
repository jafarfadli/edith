"use client";

import type { LucideIcon } from "lucide-react";
import { ariaKeys } from "@/lib/keys";
import { ICON } from "./icon";
import { Tip } from "./Tooltip";
import { useIsMac } from "./useIsMac";

/** A square icon button with a tooltip; `pressed` marks the active tool. */
export function IconButton({ label, icon: Icon, keys, pressed, disabled, onClick }: {
  label: string; icon: LucideIcon; keys?: string; pressed?: boolean; disabled?: boolean; onClick: () => void;
}) {
  const mac = useIsMac();
  return (
    <Tip label={label} keys={keys}>
      <button aria-label={label} aria-pressed={pressed} aria-keyshortcuts={keys && ariaKeys(keys, mac)} disabled={disabled} onClick={onClick}
        className={`grid h-8 w-8 shrink-0 place-items-center rounded-md transition-colors disabled:pointer-events-none disabled:text-faint/60 ${pressed ? "bg-accent/20 text-accent-text" : "text-muted hover:bg-hover hover:text-ink"}`}>
        <Icon {...ICON} />
      </button>
    </Tip>
  );
}
