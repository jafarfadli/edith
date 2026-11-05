"use client";

import { useState } from "react";
import { ApiError, exportPdf } from "@/lib/api";
import { compact } from "@/lib/compact";
import { downloadBlob } from "@/lib/download";
import { errorMessage, t } from "@/lib/strings";
import { editorStore, useEditor } from "@/store/editor";

export function Header({ onNotice }: { onNotice: (n: { kind: "error" | "info"; text: string }) => void }) {
  const info = useEditor((s) => s.info);
  const [name, setName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileName = name ?? info?.fileName ?? "document.pdf";

  async function download() {
    const s = editorStore.getState();
    if (!s.info) return;
    setBusy(true);
    try {
      const blob = await exportPdf(s.info.docId, { ops: compact(s.doc), flatten_forms: false, filename: fileName });
      downloadBlob(blob, fileName.toLowerCase().endsWith(".pdf") ? fileName : `${fileName}.pdf`);
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError("generic", 0);
      if (err.code === "bake_failed" && typeof err.extra.op_id === "string") {
        s.setTool("select");
        s.select(err.extra.op_id);
      }
      onNotice({ kind: "error", text: errorMessage(err.code) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-line bg-surface px-4">
      <span className="font-semibold text-accent">{t.appName}</span>
      <input
        aria-label={t.editor.fileName}
        value={fileName}
        onChange={(e) => setName(e.target.value)}
        className="min-w-0 max-w-xs flex-1 truncate rounded-md border border-transparent px-2 py-1 text-sm hover:border-line focus:border-accent focus:outline-none"
      />
      <div className="flex-1" />
      <button
        onClick={download}
        disabled={busy || !info}
        className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink disabled:opacity-60"
      >
        {busy ? t.editor.downloading : t.editor.download}
      </button>
    </header>
  );
}
