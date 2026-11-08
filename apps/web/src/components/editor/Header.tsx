"use client";

import { useState } from "react";
import type { Op } from "@edith/ops";
import { ApiError, exportPdf } from "@/lib/api";
import { compact, failedOpId } from "@/lib/compact";
import { downloadBlob } from "@/lib/download";
import { errorMessage, t } from "@/lib/strings";
import { editorStore, useEditor } from "@/store/editor";
import { openFind } from "./find/findStore";
import { whenTextCommitted } from "./text/textEdit";

export function Header({ onNotice }: { onNotice: (n: { kind: "error" | "info"; text: string }) => void }) {
  const info = useEditor((s) => s.info);
  const [name, setName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [flatten, setFlatten] = useState(false);
  const hasForm = useEditor((s) => (s.info?.fields?.length ?? 0) > 0 || Object.values(s.info?.importFields ?? {}).some((f) => f.length > 0));
  const fileName = name ?? info?.fileName ?? "document.pdf";

  async function download() {
    if (!editorStore.getState().info) return;
    setBusy(true);
    let s = editorStore.getState();
    let sent: Op[] = [];
    try {
      await whenTextCommitted(); // a text box whose fonts were still loading must be in the document first
      s = editorStore.getState();
      if (!s.info) return;
      sent = compact(s.doc, s.info);
      const blob = await exportPdf(s.info.docId, { ops: sent, flatten_forms: hasForm && flatten, filename: fileName });
      downloadBlob(blob, fileName.toLowerCase().endsWith(".pdf") ? fileName : `${fileName}.pdf`);
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError("generic", 0);
      if (err.code === "bake_failed" || err.code === "invalid_op") console.warn(`export ${err.code}:`, err.extra.message);
      const failed = failedOpId(err.code, err.extra, sent);
      if (failed && s.doc.objects[failed]) {
        s.setTool("select");
        s.select(failed);
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
      <button onClick={openFind} disabled={!info} className="rounded-lg px-3 py-2 text-sm hover:bg-bg disabled:opacity-60">
        🔍 {t.find.open}
      </button>
      {hasForm && (
        <label className="flex items-center gap-1.5 text-sm" title={t.form.flattenHint}>
          <input type="checkbox" checked={flatten} onChange={(e) => setFlatten(e.target.checked)} />
          {t.form.flatten}
        </label>
      )}
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
