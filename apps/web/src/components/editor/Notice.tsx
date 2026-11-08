"use client";

import { CircleAlert, Info, X } from "lucide-react";
import type { NoticeMsg } from "@/lib/notices";
import { t } from "@/lib/strings";
import { ICON } from "../ui/icon";
import { POPOVER } from "../ui/styles";

/** A toast at the bottom of the canvas (Editor renders it in the canvas wrapper): an error stays until closed, info goes away by itself (Editor). */
export function Notice({ kind, children, action, onClose }: {
  kind: "error" | "info"; children: React.ReactNode; action?: NoticeMsg["action"]; onClose?: () => void;
}) {
  const Icon = kind === "error" ? CircleAlert : Info;
  return (
    <div role={kind === "error" ? "alert" : "status"}
      className={`absolute bottom-[4.25rem] left-1/2 z-50 flex w-max max-w-[min(36rem,calc(100%-2rem))] -translate-x-1/2 items-center gap-3 py-2 pl-3 pr-2 ${POPOVER}`}>
      <Icon {...ICON} className={`shrink-0 ${kind === "error" ? "text-danger-text" : "text-accent-text"}`} />
      <span className="min-w-0 flex-1">{children}</span>
      {action && (
        <button onClick={() => { onClose?.(); action.run(); }}
          className="h-7 shrink-0 rounded-md px-2.5 text-xs font-medium text-accent-text hover:bg-hover">
          {action.label}
        </button>
      )}
      {onClose && (
        <button onClick={onClose} aria-label={t.editor.close} className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted hover:bg-hover hover:text-ink">
          <X {...ICON} />
        </button>
      )}
    </div>
  );
}
