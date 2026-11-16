"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { ApiError, runTool } from "@/lib/api";
import { saveBlob } from "@/lib/download";
import { errorMessage, t } from "@/lib/strings";
import { acceptAttr, accepted, DEFAULT_OPTIONS, fields, invalid, type ToolDef, type ToolOptions } from "@/lib/tools";
import { BTN_ICON, BTN_PRIMARY, BTN_SECONDARY, FIELD, SEGMENTED, segment } from "../ui/styles";
import { Logo } from "../brand/Logo";
import {
  ArrowDownIcon as ArrowDown, ArrowLeftIcon as ArrowLeft, ArrowUpIcon as ArrowUp, CloseIcon as X, PlusIcon as Plus,
  SpinnerIcon as LoaderCircle, UploadIcon as FileUp,
} from "../brand/icons";
import { TOOL_ICONS } from "./icons";

const MAX_BYTES = 50 * 1024 * 1024;
const LABEL = "flex flex-col gap-1.5 text-xs text-muted";

function sizeText(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Choices as a segmented control. */
function Choice<T extends string | number>({ label, value, options, names, onChange }: {
  label: string; value: T; options: readonly T[]; names: Record<string, string>; onChange: (v: T) => void;
}) {
  return (
    <div className={LABEL} role="group" aria-label={label}>
      {label}
      <div className={`${SEGMENTED} w-fit flex-wrap`}>
        {options.map((o) => (
          <button key={String(o)} type="button" aria-pressed={value === o} className={segment(value === o)} onClick={() => onChange(o)}>
            {names[String(o)]}
          </button>
        ))}
      </div>
    </div>
  );
}

/** One tool's page: its files (dropped or chosen; several in order when it takes several), its options, and "Proses",
 *  which downloads the result. A locked PDF asks its password, then goes again. */
export function ToolRunner({ tool }: { tool: ToolDef }) {
  const item = t.tools.items[tool.slug];
  const Icon = TOOL_ICONS[tool.slug];
  const images = tool.accepts === "images";
  const multiple = tool.max > 1;
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [o, setO] = useState<ToolOptions>(DEFAULT_OPTIONS);
  const [password, setPassword] = useState("");
  const [askPassword, setAskPassword] = useState(tool.password);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ blob: Blob; name: string } | null>(null);
  const set = (p: Partial<ToolOptions>) => { setO((x) => ({ ...x, ...p })); setResult(null); };

  function add(list: FileList | null | undefined) {
    if (!list?.length) return;
    const chosen = [...list];
    const bad = chosen.find((f) => !accepted(tool, f));
    setError(bad ? t.tools.wrongType(tool.accepts) : null);
    const ok = chosen.filter((f) => accepted(tool, f));
    setFiles((cur) => (multiple ? [...cur, ...ok] : ok.slice(0, 1)).slice(0, tool.max));
    setResult(null);
    if (!multiple) { setPassword(""); setAskPassword(tool.password); }
  }
  const move = (i: number, d: -1 | 1) => setFiles((cur) => {
    const next = [...cur];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    return next;
  });

  const total = files.reduce((n, f) => n + f.size, 0);
  const bad = invalid(tool, o);
  const ready = files.length >= tool.min && total <= MAX_BYTES && !bad && (!askPassword || !!password) && !busy;

  async function run() {
    if (!ready) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const out = await runTool(tool.api, files, fields(tool, o, password));
      setResult(out);
      saveBlob(out.blob, out.name);
    } catch (e) {
      const code = e instanceof ApiError ? e.code : "generic";
      if (code === "pdf_encrypted") { setAskPassword(true); setError(t.tools.passwordHint); }
      else setError(errorMessage(code));
    } finally {
      setBusy(false);
    }
  }

  const pagesField = (
    <label className={LABEL}>
      {t.tools.opts.onPages}
      <input className={FIELD} value={o.pages} onChange={(e) => set({ pages: e.target.value })} inputMode="numeric"
        placeholder={t.tools.opts.pagesAll} aria-invalid={bad === "pages"} />
    </label>
  );
  const optionsUi = (() => {
    switch (tool.api) {
      case "extract":
      case "to-images":
        return (
          <label className={LABEL}>
            {t.tools.opts.pages}
            <input className={FIELD} value={o.pages} onChange={(e) => set({ pages: e.target.value })} inputMode="numeric"
              placeholder={tool.api === "extract" ? t.tools.pagesHint : t.tools.opts.pagesAll} aria-invalid={bad === "pages"} />
            <span className="text-2xs text-faint">{t.tools.pagesHint}</span>
          </label>
        );
      case "compress":
        return <Choice label={t.tools.opts.level} value={o.level} options={["low", "medium", "high"] as const} names={t.tools.opts.levels} onChange={(level) => set({ level })} />;
      case "split":
        return (
          <>
            <Choice label={t.tools.opts.mode} value={o.mode} options={["every", "ranges"] as const}
              names={{ every: t.tools.opts.modeEvery, ranges: t.tools.opts.modeRanges }} onChange={(mode) => set({ mode })} />
            {o.mode === "every" ? (
              <label className={LABEL}>
                {t.tools.opts.every}
                <input className={`${FIELD} w-24`} type="number" min={1} value={o.every} onChange={(e) => set({ every: Number(e.target.value) })} aria-invalid={bad === "every"} />
              </label>
            ) : (
              <label className={LABEL}>
                {t.tools.opts.ranges}
                <input className={FIELD} value={o.ranges} onChange={(e) => set({ ranges: e.target.value })} placeholder={t.tools.opts.rangesHint} aria-invalid={bad === "ranges"} />
              </label>
            )}
          </>
        );
      case "images-to-pdf":
        return (
          <>
            <Choice label={t.tools.opts.size} value={o.size} options={["a4", "fit"] as const} names={t.tools.opts.sizes} onChange={(size) => set({ size })} />
            {o.size === "a4" && <Choice label={t.tools.opts.margin} value={o.margin} options={[0, 20, 40] as const} names={t.tools.opts.margins} onChange={(margin) => set({ margin })} />}
          </>
        );
      case "protect":
        return (
          <>
            <label className={LABEL}>
              {t.tools.opts.newPassword}
              <input className={FIELD} type="password" autoComplete="new-password" value={o.newPassword} onChange={(e) => set({ newPassword: e.target.value })} />
            </label>
            <label className={LABEL}>
              {t.tools.opts.confirm}
              <input className={FIELD} type="password" autoComplete="new-password" value={o.confirm} onChange={(e) => set({ confirm: e.target.value })} aria-invalid={bad === "mismatch"} />
              {bad === "mismatch" && o.confirm && <span className="text-2xs text-danger-text">{t.tools.opts.mismatch}</span>}
            </label>
            <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={o.allowPrint} onChange={(e) => set({ allowPrint: e.target.checked })} />{t.tools.opts.allowPrint}</label>
            <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={o.allowCopy} onChange={(e) => set({ allowCopy: e.target.checked })} />{t.tools.opts.allowCopy}</label>
          </>
        );
      case "watermark":
        return (
          <>
            <label className={LABEL}>
              {t.tools.opts.text}
              <input className={FIELD} value={o.text} maxLength={120} onChange={(e) => set({ text: e.target.value })} placeholder={t.tools.opts.textHint} />
            </label>
            <Choice label={t.tools.opts.strength} value={o.strength} options={["light", "medium", "strong"] as const} names={t.tools.opts.strengths} onChange={(strength) => set({ strength })} />
            <Choice label={t.tools.opts.direction} value={o.diagonal ? "diagonal" : "level"} options={["diagonal", "level"] as const} names={t.tools.opts.directions} onChange={(d) => set({ diagonal: d === "diagonal" })} />
            <Choice label={t.tools.opts.colour} value={o.colour} options={Object.keys(t.tools.opts.colours)} names={t.tools.opts.colours} onChange={(colour) => set({ colour })} />
            {pagesField}
          </>
        );
      case "page-numbers":
        return (
          <>
            <Choice label={t.tools.opts.position} value={o.position} options={["top-left", "top-center", "top-right", "bottom-left", "bottom-center", "bottom-right"] as const} names={t.tools.opts.positions} onChange={(position) => set({ position })} />
            <Choice label={t.tools.opts.numberFormat} value={o.numberFormat} options={["n", "n_of", "page_n", "page_n_of"] as const} names={t.tools.opts.numberFormats} onChange={(numberFormat) => set({ numberFormat })} />
            <label className={LABEL}>
              {t.tools.opts.start}
              <input className={`${FIELD} w-24`} type="number" min={0} value={o.start} onChange={(e) => set({ start: Number(e.target.value) })} aria-invalid={bad === "start"} />
            </label>
            {pagesField}
          </>
        );
      case "ocr":
        return <p className="text-xs text-muted">{t.tools.opts.ocrNote}</p>;
      case "to-docx":
        return <p className="text-xs text-muted">{t.tools.opts.wordNote}</p>;
      default:
        return null;
    }
  })();
  const imageFormat = tool.api === "to-images" && (
    <>
      <Choice label={t.tools.opts.format} value={o.format} options={["png", "jpg"] as const} names={{ png: "PNG", jpg: "JPG" }} onChange={(format) => set({ format })} />
      <Choice label={t.tools.opts.dpi} value={o.dpi} options={[72, 150, 300] as const} names={t.tools.opts.dpiNames} onChange={(dpi) => set({ dpi })} />
    </>
  );

  return (
    <div className="relative flex min-h-dvh flex-col overflow-x-clip bg-base">
      <div aria-hidden className="bench-grid bench-fade pointer-events-none absolute inset-x-0 top-0 h-[40rem]" />
      <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center gap-3 px-5 pt-6 md:px-10">
        <Link href="/" aria-label={t.appName} className="rounded-md"><Logo /></Link>
        <span aria-hidden className="text-faint">/</span>
        <Link href="/#tools" className="text-sm text-muted hover:text-ink">{t.tools.heading}</Link>
      </header>
      <main className="relative z-10 mx-auto flex w-full max-w-2xl flex-col gap-6 px-5 py-12" data-testid="tool-page">
        <Link href="/" className="flex w-fit items-center gap-1.5 text-xs text-muted hover:text-ink"><ArrowLeft size={14} aria-hidden />{t.tools.back}</Link>
        <div className="flex items-start gap-3">
          <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-accent/10 text-accent-text"><Icon size={20} strokeWidth={1.75} /></span>
          <div>
            <h1 className="font-wide text-3xl font-bold tracking-tight text-ink">{item.name}</h1>
            <p className="mt-1 text-sm text-muted">{item.desc}</p>
          </div>
        </div>

        <div
          data-testid="tool-drop"
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false); }}
          onDrop={(e) => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); }}
          className={`flex flex-col items-center gap-3 rounded-[3px] px-6 py-9 text-center outline-dashed outline-offset-[-10px] transition-[background-color,outline-color,translate,box-shadow] duration-300 ease-out-expo ${over ? "-translate-y-1 bg-raised shadow-sheet-lifted outline-2 outline-accent" : "bg-panel shadow-sheet outline-1 outline-line-strong"}`}
        >
          <FileUp size={30} strokeWidth={1.5} className="text-accent-text" />
          <p className="text-sm text-ink">{t.tools.drop(tool.accepts)}</p>
          <button type="button" className={files.length && multiple ? BTN_SECONDARY : BTN_PRIMARY} onClick={() => input.current?.click()}>
            {files.length && multiple ? <><Plus size={14} aria-hidden />{t.tools.add}</> : t.tools.choose}
          </button>
          <p className="text-2xs text-faint">{images ? t.tools.limitImages : tool.accepts === "office" ? t.tools.limitOffice : t.tools.limitPdf}</p>
          <input ref={input} type="file" hidden multiple={multiple} data-testid="tool-input"
            accept={acceptAttr(tool)}
            onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
        </div>

        {files.length > 0 && (
          <ol className="flex flex-col gap-1.5" data-testid="tool-files">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-md bg-panel px-3 py-2 ring-1 ring-inset ring-line">
                {multiple && <span className="w-5 text-right text-xs tabular-nums text-faint">{i + 1}</span>}
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{f.name}</span>
                <span className="text-xs tabular-nums text-faint">{sizeText(f.size)}</span>
                {multiple && (
                  <>
                    <button type="button" className={BTN_ICON} disabled={i === 0} aria-label={t.tools.up(f.name)} onClick={() => move(i, -1)}><ArrowUp size={14} /></button>
                    <button type="button" className={BTN_ICON} disabled={i === files.length - 1} aria-label={t.tools.down(f.name)} onClick={() => move(i, 1)}><ArrowDown size={14} /></button>
                  </>
                )}
                <button type="button" className={BTN_ICON} aria-label={t.tools.remove(f.name)} onClick={() => { setFiles((cur) => cur.filter((_, k) => k !== i)); setResult(null); }}><X size={14} /></button>
              </li>
            ))}
          </ol>
        )}

        {(optionsUi || imageFormat || askPassword) && (
          <div className="flex flex-col gap-4 rounded-lg bg-panel p-4 ring-1 ring-inset ring-line">
            {askPassword && (
              <label className={LABEL}>
                {t.tools.password}
                <input className={FIELD} type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} data-testid="tool-password" />
              </label>
            )}
            {optionsUi}
            {imageFormat}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className={BTN_PRIMARY} disabled={!ready} onClick={run} data-testid="tool-run">
            {busy && <LoaderCircle size={16} className="animate-spin" aria-hidden />}
            {busy ? t.tools.running : t.tools.run}
          </button>
          {files.length > 0 && files.length < tool.min && <span className="text-xs text-muted">{t.tools.needFiles(tool.min)}</span>}
          {total > MAX_BYTES && <span className="text-xs text-danger-text">{errorMessage("too_large")}</span>}
        </div>
        {error && <p role="alert" className="text-sm text-danger-text">{error}</p>}
        {result && (
          <div role="status" className="flex flex-wrap items-center gap-3 text-sm text-ink" data-testid="tool-done">
            {t.tools.done(result.name)} <span className="text-xs text-faint">({sizeText(result.blob.size)})</span>
            <button type="button" className={BTN_SECONDARY} onClick={() => saveBlob(result.blob, result.name)}>{t.tools.again}</button>
          </div>
        )}
      </main>
    </div>
  );
}
