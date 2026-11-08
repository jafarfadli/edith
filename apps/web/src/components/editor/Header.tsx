"use client";

import { Download, LoaderCircle, Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { Op } from "@edith/ops";
import { ApiError, exportPdf } from "@/lib/api";
import { compact, failedOpId } from "@/lib/compact";
import { downloadError, isPdfBlob, openBlob, saveBlob } from "@/lib/download";
import type { NoticeMsg } from "@/lib/notices";
import { t } from "@/lib/strings";
import { editorStore, useEditor } from "@/store/editor";
import { ICON } from "../ui/icon";
import { IconButton } from "../ui/IconButton";
import { Tip } from "../ui/Tooltip";
import { openFind } from "./find/findStore";
import { whenTextCommitted } from "./text/textEdit";

/** The editor's one top bar: wordmark and file name, the tools (`children`), then Cari, Ratakan form and Unduh. */
export function Header({ onNotice, children }: { onNotice: (n: NoticeMsg) => void; children?: React.ReactNode }) {
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
      if (!(await isPdfBlob(blob))) throw new ApiError("bad_response", 200);
      const name = fileName.toLowerCase().endsWith(".pdf") ? fileName : `${fileName}.pdf`;
      // A download the browser blocks silently still leaves the notice's "Buka di tab baru" (a fresh click: no popup block).
      const openTab = { label: t.download.openTab, run: () => { if (!openBlob(blob)) onNotice({ kind: "error", text: t.download.blocked }); } };
      if (saveBlob(blob, name) === "blocked") onNotice({ kind: "error", text: t.download.blocked, action: openTab });
      else onNotice({ kind: "info", text: t.download.started(name), action: openTab });
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError("generic", 0);
      if (err.code === "bake_failed" || err.code === "invalid_op") console.warn(`export ${err.code}:`, err.extra.message);
      else console.warn("export failed:", e);
      const failed = failedOpId(err.code, err.extra, sent);
      if (failed && s.doc.objects[failed]) {
        s.setTool("select");
        s.select(failed);
      }
      const { message, retry } = downloadError(err);
      onNotice({ kind: "error", text: message, action: retry ? { label: t.download.retry, run: () => void download() } : undefined });
    } finally {
      setBusy(false);
    }
  }

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-panel px-2">
      <Link href="/" className="flex h-8 shrink-0 items-center gap-2 rounded-md px-2 font-semibold tracking-tight text-ink hover:bg-hover">
        <span aria-hidden className="h-2.5 w-2.5 rounded-[3px] bg-accent" />
        {t.appName}
      </Link>
      <input
        aria-label={t.editor.fileName}
        value={fileName}
        onChange={(e) => setName(e.target.value)}
        className="h-8 w-36 min-w-0 shrink truncate rounded-md xl:w-52 border border-transparent bg-transparent px-2 text-sm text-muted hover:border-line-strong focus:border-accent focus:text-ink focus:outline-none focus:ring-1 focus:ring-accent"
      />
      {children}
      <div className="flex shrink-0 items-center gap-1">
        <IconButton label={t.find.open} icon={Search} keys="Mod+F" disabled={!info} onClick={openFind} />
        {hasForm && (
          // Below xl only the checkbox shows (its name in the tooltip), so every tool still fits the bar at 1024 px.
          <Tip label={`${t.form.flatten}. ${t.form.flattenHint}.`} wide>
            <label className="flex h-8 cursor-pointer items-center gap-1.5 rounded-md px-2 text-xs text-muted hover:bg-hover hover:text-ink">
              <input type="checkbox" aria-label={t.form.flatten} checked={flatten} onChange={(e) => setFlatten(e.target.checked)} />
              <span aria-hidden className="hidden xl:inline">{t.form.flatten}</span>
            </label>
          </Tip>
        )}
        <button
          onClick={download}
          disabled={busy || !info}
          className="ml-1 flex h-8 items-center gap-2 rounded-md bg-accent px-3 text-sm font-medium text-accent-ink transition-colors hover:bg-accent-hover disabled:opacity-60"
        >
          {busy ? <LoaderCircle {...ICON} className="animate-spin" /> : <Download {...ICON} />}
          {busy ? t.editor.downloading : t.editor.download}
        </button>
      </div>
    </header>
  );
}
