"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { ExportOutput, Op } from "@edith/ops";
import { useStore } from "zustand";
import { ApiError, exportFile, exportPdf } from "@/lib/api";
import { downloadStore } from "@/store/download";
import { checkAlive, isGone } from "@/lib/session";
import { compact, failedOpId } from "@/lib/compact";
import { downloadError, downloadName, isPdfBlob, openBlob, savedNotice, saveBlob } from "@/lib/download";
import type { NoticeMsg } from "@/lib/notices";
import { t } from "@/lib/strings";
import { editorStore, useEditor } from "@/store/editor";
import { LogoMark } from "../brand/Logo";
import { ChevronDownIcon, DownloadIcon, RedoIcon, SearchIcon, SpinnerIcon, UndoIcon } from "../brand/icons";
import { ICON } from "../ui/icon";
import { IconButton } from "../ui/IconButton";
import { Tip } from "../ui/Tooltip";
import { openFind } from "./find/findStore";
import { afterTextCommitted, whenTextCommitted } from "./text/textEdit";

/** The editor's top bar: the mark (home) and the file name, then Urungkan/Ulangi, Cari, Ratakan form and Unduh. The
 *  tools are on the rail (Toolbar). */
export function Header({ onNotice }: { onNotice: (n: NoticeMsg | null) => void }) {
  const info = useEditor((s) => s.info);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const [name, setName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [flatten, setFlatten] = useState(false);
  const hasForm = useEditor((s) => (s.info?.fields?.length ?? 0) > 0 || Object.values(s.info?.importFields ?? {}).some((f) => f.length > 0));
  const fileName = name ?? info?.fileName ?? "document.pdf";

  // One export at a time: Enter held on the button or "Coba lagi" while a request runs must not start another.
  const inFlight = useRef(false);
  // "Coba lagi" runs the download of the latest render: the file name or "Ratakan form" may have changed since.
  const latest = useRef<() => Promise<void>>(async () => {});
  // The options of the latest download, which "Coba lagi" repeats.
  const lastOutput = useRef<ExportOutput | undefined>(undefined);

  /** `output`: only some pages, pictures, compressed or locked (the options dialog); none: the plain PDF. */
  async function download(output?: ExportOutput) {
    if (inFlight.current || !editorStore.getState().info) return;
    lastOutput.current = output;
    inFlight.current = true;
    setBusy(true);
    onNotice(null); // the previous attempt's notice no longer applies
    let s = editorStore.getState();
    let sent: Op[] = [];
    try {
      await whenTextCommitted(); // a text box whose fonts were still loading must be in the document first
      s = editorStore.getState();
      if (!s.info) return;
      sent = compact(s.doc, s.info);
      let name = downloadName(fileName, s.info.fileName);
      let blob: Blob;
      if (output) {
        const got = await exportFile(s.info.docId, { ops: sent, flatten_forms: hasForm && flatten, filename: name, output });
        blob = got.blob;
        name = got.name;
      } else {
        blob = await exportPdf(s.info.docId, { ops: sent, flatten_forms: hasForm && flatten, filename: name });
      }
      if ((!output || (output.format ?? "pdf") === "pdf") && !(await isPdfBlob(blob))) throw new ApiError("bad_response", 200);
      // A download the browser blocks silently still leaves the notice's "Buka di tab baru" (a fresh click: no popup block).
      const openTab = { label: t.download.openTab, run: () => { if (!openBlob(blob)) onNotice({ kind: "error", text: t.download.blocked }); } };
      onNotice(savedNotice(saveBlob(blob, name), name, openTab));
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError("generic", 0);
      // The server dropped the document: the edit is put back and the page reopens it (press Unduh again). Without a
      // kept copy the message below says so.
      if (isGone(err) && s.info && (await checkAlive(s.info.editId, s.info.docId)) === "moved") { window.location.reload(); return; }
      if (err.code === "bake_failed" || err.code === "invalid_op") console.warn(`export ${err.code}:`, err.extra.message);
      else console.warn("export failed:", e);
      const failed = failedOpId(err.code, err.extra, sent);
      if (failed && s.doc.objects[failed]) {
        s.setTool("select");
        s.select(failed);
      }
      const { message, retry } = downloadError(err);
      onNotice({ kind: "error", text: message, action: retry ? { label: t.download.retry, run: () => void latest.current() } : undefined });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  useEffect(() => { latest.current = () => download(lastOutput.current); });
  // A download the options dialog asked for.
  const asked = useStore(downloadStore, (x) => x.request);
  useEffect(() => {
    if (!asked) return;
    const output = downloadStore.getState().take();
    if (output) void download(output);
  }, [asked]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <header className="flex h-14 shrink-0 items-center gap-1.5 border-b border-line bg-panel px-2 sm:gap-2">
      <Link href="/" aria-label={t.appName} title={t.appName} className="grid h-10 w-10 shrink-0 place-items-center rounded-lg hover:bg-hover sm:w-[3.75rem]">
        <LogoMark size={34} />
      </Link>
      <input
        aria-label={t.editor.fileName}
        value={fileName}
        onChange={(e) => { setName(e.target.value); downloadStore.setState({ fileName: e.target.value }); }}
        className="h-8 w-36 min-w-0 flex-1 truncate rounded-md font-medium sm:flex-none xl:w-60 border border-transparent bg-transparent px-2 text-sm text-muted hover:border-line-strong focus:border-accent focus:text-ink focus:outline-none focus:ring-1 focus:ring-accent"
      />
      <div className="hidden flex-1 sm:block" />
      <div className="flex shrink-0 items-center gap-0.5">
        <IconButton label={t.editor.undo} icon={UndoIcon} keys="Mod+Z" disabled={!canUndo} onClick={() => afterTextCommitted(() => editorStore.getState().undo())} />
        <IconButton label={t.editor.redo} icon={RedoIcon} keys="Mod+Shift+Z" disabled={!canRedo} onClick={() => afterTextCommitted(() => editorStore.getState().redo())} />
        <span aria-hidden className="mx-1 h-5 w-px bg-line" />
        <IconButton label={t.find.open} icon={SearchIcon} keys="Mod+F" disabled={!info} onClick={openFind} />
        {hasForm && (
          // Below xl only the checkbox shows (its name in the tooltip), so every tool still fits the bar at 1024 px.
          <Tip label={`${t.form.flatten}. ${t.form.flattenHint}.`} wide>
            <label className="flex h-8 cursor-pointer items-center gap-1.5 rounded-md px-2 text-xs text-muted hover:bg-hover hover:text-ink">
              <input type="checkbox" aria-label={t.form.flatten} checked={flatten} onChange={(e) => setFlatten(e.target.checked)} />
              <span aria-hidden className="hidden xl:inline">{t.form.flatten}</span>
            </label>
          </Tip>
        )}
        <div className="ml-1.5 flex h-9 items-stretch overflow-hidden rounded-md bg-accent text-accent-ink shadow-[0_1px_0_oklch(100%_0_0/0.3)_inset]">
          <button
            onClick={() => download()}
            disabled={busy || !info}
            className="flex items-center gap-2 px-3 text-sm font-semibold transition-colors hover:bg-accent-hover disabled:opacity-60"
          >
            {busy ? <SpinnerIcon {...ICON} className="animate-spin" /> : <DownloadIcon {...ICON} />}
            <span className={busy ? "hidden sm:inline" : undefined}>{busy ? t.editor.downloading : t.editor.download}</span>
          </button>
          <Tip label={t.downloadOptions.open}>
            <button
              aria-label={t.downloadOptions.open}
              data-testid="download-options"
              onClick={() => downloadStore.getState().open()}
              disabled={busy || !info}
              className="flex items-center gap-1 border-l border-accent-ink/20 px-2 text-xs font-semibold transition-colors hover:bg-accent-hover disabled:opacity-60"
            >
              <span aria-hidden className="hidden md:inline">{t.downloadOptions.short}</span>
              <ChevronDownIcon {...ICON} />
            </button>
          </Tip>
        </div>
      </div>
    </header>
  );
}
