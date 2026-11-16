"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import type { ExportOutput } from "@edith/ops";
import { t } from "@/lib/strings";
import { DEFAULT_OPTIONS, invalid, toolBySlug } from "@/lib/tools";
import { downloadStore } from "@/store/download";
import { BACKDROP, BTN_ICON, BTN_PRIMARY, BTN_QUIET, DIALOG, DIALOG_TITLE, FIELD, SEGMENTED, segment } from "../ui/styles";

const LABEL = "flex flex-col gap-1.5 text-xs text-muted";
type Kind = "pdf" | "images";
type Level = "none" | "low" | "medium" | "high";

function Seg<T extends string | number>({ label, value, options, names, onChange }: {
  label: string; value: T; options: readonly T[]; names: Record<string, string>; onChange: (v: T) => void;
}) {
  return (
    <div className={LABEL} role="group" aria-label={label}>
      {label}
      <div className={`${SEGMENTED} w-fit flex-wrap`}>
        {options.map((o) => (
          <button key={String(o)} type="button" aria-pressed={value === o} className={segment(value === o)} onClick={() => onChange(o)}>{names[String(o)]}</button>
        ))}
      </div>
    </div>
  );
}

/** "Opsi unduhan": the edited document as only some pages, as pictures (PNG/JPG), compressed, or locked with a
 *  password. Unduh asks the Header to run it (downloadStore). */
export function DownloadDialog() {
  const dialog = useStore(downloadStore, (s) => s.dialog);
  if (!dialog) return null;
  return <Dialog pages={dialog.pages} />;
}

function Dialog({ pages: initialPages }: { pages: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [kind, setKind] = useState<Kind>("pdf");
  const [pages, setPages] = useState(initialPages);
  const [level, setLevel] = useState<Level>("none");
  const [lock, setLock] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [allowPrint, setAllowPrint] = useState(true);
  const [allowCopy, setAllowCopy] = useState(true);
  const [format, setFormat] = useState<"png" | "jpg">("png");
  const [dpi, setDpi] = useState<72 | 150 | 300>(150);
  const close = () => downloadStore.getState().close();
  useEffect(() => { box.current?.focus(); }, []);

  const badPages = invalid(toolBySlug("pdf-ke-gambar")!, { ...DEFAULT_OPTIONS, pages }) === "pages";
  const mismatch = lock && !!confirm && password !== confirm;
  const ready = !badPages && (kind === "images" || !lock || (!!password && password === confirm));

  function submit() {
    if (!ready) return;
    const output: ExportOutput = kind === "images"
      ? { format, dpi, ...(pages.trim() ? { pages } : {}) }
      : {
        ...(pages.trim() ? { pages } : {}),
        ...(level !== "none" ? { compress: level } : {}),
        ...(lock ? { password, allow_print: allowPrint, allow_copy: allowCopy } : {}),
      };
    downloadStore.getState().ask(output);
  }

  return (
    <div className={`${BACKDROP} items-start pt-20`} onPointerDown={close}>
      <div ref={box} tabIndex={-1} role="dialog" aria-label={t.downloadOptions.title} data-testid="download-dialog"
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") close(); }}
        className={`${DIALOG} w-[28rem] max-w-[calc(100vw-2rem)] gap-4 p-4`}>
        <div className="flex items-center justify-between">
          <span className={DIALOG_TITLE}>{t.downloadOptions.title}</span>
          <button type="button" className={BTN_ICON} aria-label={t.downloadOptions.close} onClick={close}><X size={16} /></button>
        </div>
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <Seg label={t.downloadOptions.as} value={kind} options={["pdf", "images"] as const}
            names={{ pdf: "PDF", images: t.downloadOptions.images }} onChange={setKind} />
          <label className={LABEL}>
            {t.tools.opts.pages}
            <input className={FIELD} value={pages} onChange={(e) => setPages(e.target.value)} inputMode="numeric"
              placeholder={t.tools.opts.pagesAll} aria-invalid={badPages} />
            <span className="text-2xs text-faint">{t.tools.pagesHint}</span>
          </label>
          {kind === "images" ? (
            <>
              <Seg label={t.tools.opts.format} value={format} options={["png", "jpg"] as const} names={{ png: "PNG", jpg: "JPG" }} onChange={setFormat} />
              <Seg label={t.tools.opts.dpi} value={dpi} options={[72, 150, 300] as const} names={t.tools.opts.dpiNames} onChange={setDpi} />
            </>
          ) : (
            <>
              <Seg label={t.tools.opts.level} value={level} options={["none", "low", "medium", "high"] as const}
                names={t.downloadOptions.levels} onChange={setLevel} />
              <label className="flex items-center gap-2 text-sm text-ink">
                <input type="checkbox" checked={lock} onChange={(e) => setLock(e.target.checked)} />{t.downloadOptions.lock}
              </label>
              {lock && (
                <div className="flex flex-col gap-3 pl-6">
                  <label className={LABEL}>
                    {t.tools.opts.newPassword}
                    <input className={FIELD} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                  </label>
                  <label className={LABEL}>
                    {t.tools.opts.confirm}
                    <input className={FIELD} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={mismatch} />
                    {mismatch && <span className="text-2xs text-danger-text">{t.tools.opts.mismatch}</span>}
                  </label>
                  <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={allowPrint} onChange={(e) => setAllowPrint(e.target.checked)} />{t.tools.opts.allowPrint}</label>
                  <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={allowCopy} onChange={(e) => setAllowCopy(e.target.checked)} />{t.tools.opts.allowCopy}</label>
                </div>
              )}
            </>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" className={BTN_QUIET} onClick={close}>{t.downloadOptions.cancel}</button>
            <button type="submit" className={BTN_PRIMARY} disabled={!ready} data-testid="download-options-go">{t.editor.download}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
