"use client";

import { t } from "@/lib/strings";

export function Notice({ kind, children, onClose }: { kind: "error" | "info"; children: React.ReactNode; onClose?: () => void }) {
  return (
    <div role={kind === "error" ? "alert" : "status"}
      className={`fixed left-1/2 top-16 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg px-4 py-2 text-sm shadow-lg ${kind === "error" ? "bg-danger text-white" : "bg-ink text-white"}`}>
      <span>{children}</span>
      {onClose && <button onClick={onClose} aria-label={t.editor.close} className="opacity-80 hover:opacity-100">✕</button>}
    </div>
  );
}
