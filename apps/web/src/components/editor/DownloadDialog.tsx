"use client";

import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import type { ExportOutput } from "@edith/ops";
import { t } from "@/lib/strings";
import { countPages, DEFAULT_OPTIONS, invalid, toolBySlug } from "@/lib/tools";
import { downloadStore } from "@/store/download";
import { editorStore } from "@/store/editor";
import { CloseIcon, DownloadIcon, LockIcon, SheetIcon, ToImagesIcon } from "../brand/icons";
import { BTN_ICON, BTN_PRIMARY, BTN_QUIET, FIELD, SEGMENTED, segment } from "../ui/styles";

const LABEL = "flex flex-col gap-1.5 text-xs text-muted";
const SECTION = "flex flex-col gap-4 border-t border-line px-5 py-5 first:border-t-0";
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

/** What to download as, a sheet you pick up: its icon, name and what it becomes. */
function KindCard({ on, label, hint, icon: Icon, onPick }: { on: boolean; label: string; hint: string; icon: typeof SheetIcon; onPick: () => void }) {
  return (
    <button type="button" aria-pressed={on} aria-label={label} onClick={onPick}
      className={`flex flex-1 flex-col items-start gap-2 rounded-lg px-3.5 py-3 text-left ring-1 ring-inset transition-[background-color,box-shadow,translate] duration-200 ease-out-expo ${on ? "bg-accent/12 ring-2 ring-accent" : "ring-line-strong hover:-translate-y-px hover:bg-hover"}`}>
      <Icon size={22} strokeWidth={1.5} className={on ? "text-accent-text" : "text-muted"} />
      <span aria-hidden className="flex flex-col">
        <span className="font-medium text-ink">{label}</span>
        <span className="text-2xs text-faint">{hint}</span>
      </span>
    </button>
  );
}

/** "Opsi unduhan": the edited document as only some pages, as pictures (PNG/JPG), compressed, or locked with a
 *  password. A panel from the right (from the bottom on a phone); its foot says what will come out before Unduh asks
 *  the Header to run it (downloadStore). */
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
  const typedName = useStore(downloadStore, (s) => s.fileName);
  const [{ total, docName }] = useState(() => {
    const s = editorStore.getState();
    return { total: s.doc.pages.length, docName: s.info?.fileName ?? "document.pdf" };
  });
  const close = () => downloadStore.getState().close();
  useEffect(() => { box.current?.focus(); }, []);

  const badPages = invalid(toolBySlug("pdf-ke-gambar")!, { ...DEFAULT_OPTIONS, pages }) === "pages";
  const count = countPages(pages, total);
  const mismatch = lock && !!confirm && password !== confirm;
  const ready = !badPages && count !== 0 && (kind === "images" || !lock || (!!password && password === confirm));

  // The foot's summary: the file that comes out and what was done to it.
  const base = (typedName?.trim() || docName).replace(/\.pdf$/i, "") || "document";
  const o = t.downloadOptions;
  const summary = count === null || count === 0 ? [count === 0 ? o.noPages : t.tools.pagesHint]
    : kind === "images"
      ? [count === 1 ? `${base}.${format}` : `${base}.zip`, o.picturesN(count, format.toUpperCase())]
      : [`${base}.pdf`, o.pagesN(count), ...(level !== "none" ? [o.compressed(o.levels[level])] : []), ...(lock ? [o.lockedNote] : [])];

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
    <div className="animate-fade-in fixed inset-0 z-40 flex items-end justify-end bg-base/70 sm:items-stretch" onPointerDown={close}>
      <div ref={box} tabIndex={-1} role="dialog" aria-label={o.title} data-testid="download-dialog"
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") close(); }}
        className="animate-drawer-up flex max-h-[88dvh] w-full flex-col rounded-t-2xl bg-raised text-sm text-ink shadow-modal outline-none sm:animate-drawer-right sm:max-h-none sm:w-[26rem] sm:rounded-none sm:border-l sm:border-line-strong">
        <div className="flex items-center justify-between px-5 pb-2 pt-4">
          <span className="font-wide text-lg font-bold tracking-tight">{o.title}</span>
          <button type="button" className={BTN_ICON} aria-label={o.close} onClick={close}><CloseIcon size={18} /></button>
        </div>
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className={SECTION}>
              <div className={LABEL} role="group" aria-label={o.as}>
                {o.as}
                <div className="flex gap-2">
                  <KindCard on={kind === "pdf"} label="PDF" hint={o.pdfHint} icon={SheetIcon} onPick={() => setKind("pdf")} />
                  <KindCard on={kind === "images"} label={o.images} hint={o.imagesHint} icon={ToImagesIcon} onPick={() => setKind("images")} />
                </div>
              </div>
              <label className={LABEL}>
                {t.tools.opts.pages}
                <input className={FIELD} value={pages} onChange={(e) => setPages(e.target.value)} inputMode="numeric"
                  placeholder={t.tools.opts.pagesAll} aria-invalid={badPages} />
                <span className="text-2xs text-faint">{t.tools.pagesHint}</span>
              </label>
            </div>
            {kind === "images" ? (
              <div className={SECTION}>
                <Seg label={t.tools.opts.format} value={format} options={["png", "jpg"] as const} names={{ png: "PNG", jpg: "JPG" }} onChange={setFormat} />
                <Seg label={t.tools.opts.dpi} value={dpi} options={[72, 150, 300] as const} names={t.tools.opts.dpiNames} onChange={setDpi} />
              </div>
            ) : (
              <>
                <div className={SECTION}>
                  <Seg label={t.tools.opts.level} value={level} options={["none", "low", "medium", "high"] as const}
                    names={o.levels} onChange={setLevel} />
                </div>
                <div className={SECTION}>
                  <label className="flex items-center gap-2.5 text-sm text-ink">
                    <input type="checkbox" checked={lock} onChange={(e) => setLock(e.target.checked)} />
                    <LockIcon size={16} className={lock ? "text-accent-text" : "text-muted"} />{o.lock}
                  </label>
                  {lock && (
                    <div className="flex flex-col gap-3">
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
                </div>
              </>
            )}
          </div>
          <div className="flex flex-col gap-3 border-t border-line-strong bg-panel px-5 pb-5 pt-4">
            <div className="flex flex-col gap-0.5" data-testid="download-summary" aria-live="polite">
              <span className="font-condensed text-2xs font-semibold uppercase tracking-[0.14em] text-faint">{o.result}</span>
              <span className={`truncate text-sm ${count ? "font-medium text-ink" : "text-danger-text"}`}>{summary[0]}</span>
              {summary.length > 1 && <span className="text-xs text-muted">{summary.slice(1).join(" · ")}</span>}
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className={BTN_QUIET} onClick={close}>{o.cancel}</button>
              <button type="submit" className={`${BTN_PRIMARY} h-9 px-4`} disabled={!ready} data-testid="download-options-go">
                <DownloadIcon size={16} />{t.editor.download}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
