"use client";

import type { ContentOp } from "@edith/ops";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { newId } from "@/lib/id";
import { findSensitive, type Finding } from "@/lib/sensitive";
import { t } from "@/lib/strings";
import { charsStore } from "@/store/chars";
import { editorStore } from "@/store/editor";
import { CloseIcon as X, SpinnerIcon } from "../../brand/icons";
import { BACKDROP, BTN_ICON, BTN_PRIMARY, BTN_QUIET, BTN_SECONDARY, DIALOG, DIALOG_TITLE } from "../../ui/styles";
import { markLines } from "./markupTool";

/** Pages read at once while looking (each is one request for its character boxes). */
const AT_ONCE = 4;
/** Room around the characters a redaction covers (pt), so no edge of a digit peeks out. */
const PAD = 1;

interface PageFindings { pageKey: string; number: number; items: (Finding & { key: string })[] }

/** Reads every page's text and lists the personal data in it (lib/sensitive.ts), page by page. */
async function look(onProgress: (done: number, total: number) => void): Promise<PageFindings[]> {
  const pages = editorStore.getState().doc.pages;
  const out: PageFindings[] = [];
  let next = 0, done = 0;
  async function worker() {
    while (next < pages.length) {
      const i = next++;
      const entry = pages[i];
      if ("doc" in entry.src) {
        await charsStore.getState().load(entry.src.doc, entry.src.index);
        const items = findSensitive(markLines(entry.pageKey)).map((f, k) => ({ ...f, key: `${entry.pageKey}:${k}` }));
        if (items.length) out.push({ pageKey: entry.pageKey, number: i + 1, items });
      }
      onProgress(++done, pages.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, pages.length) }, worker));
  return out.sort((a, b) => a.number - b.number);
}

/** "Cari data pribadi" on the redaction tool's bar: finds NIK, NPWP, mobile numbers, email addresses and account
 *  numbers in the document's text and blacks out the ones kept ticked, as ordinary redactions (each can still be
 *  moved, resized or deleted, and undone together). */
export function AutoRedact() {
  const [open, setOpen] = useState(false);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [found, setFound] = useState<PageFindings[] | null>(null);
  const [off, setOff] = useState<Set<string>>(new Set());
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    box.current?.focus();
    look((d, n) => { if (live) setProgress([d, n]); }).then((f) => { if (live) setFound(f); });
    return () => { live = false; };
  }, [open]);

  function close() { setOpen(false); setFound(null); setProgress(null); setOff(new Set()); }

  const all = found?.flatMap((p) => p.items.map((f) => ({ ...f, pageKey: p.pageKey }))) ?? [];
  const chosen = all.filter((f) => !off.has(f.key));

  function apply() {
    const ops = chosen.flatMap((f) => f.rects.map((r): ContentOp => ({
      id: newId(), type: "redact.add", pageKey: f.pageKey, fill: "black",
      rect: { x: r.x - PAD, y: r.y - PAD, w: r.w + 2 * PAD, h: r.h + 2 * PAD },
    } as ContentOp)));
    if (ops.length) editorStore.getState().putObjects(ops);
    close();
  }

  const toggle = (key: string) => setOff((cur) => { const s = new Set(cur); if (s.has(key)) s.delete(key); else s.add(key); return s; });

  return (
    <>
      <button type="button" className={BTN_SECONDARY} onClick={() => setOpen(true)} data-testid="auto-redact">{t.redact.find}</button>
      {open && createPortal(
        <div className={`${BACKDROP} items-start pt-20`} onPointerDown={close}>
          <div ref={box} tabIndex={-1} role="dialog" aria-label={t.redact.title} onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") close(); }}
            className={`${DIALOG} max-h-[calc(100dvh-8rem)] w-[30rem] max-w-[calc(100vw-2rem)] gap-4 p-4`}>
            <div className="flex items-center gap-2">
              <span className={DIALOG_TITLE}>{t.redact.title}</span>
              <div className="flex-1" />
              <button type="button" aria-label={t.editor.close} onClick={close} className={BTN_ICON}><X size={16} /></button>
            </div>
            {!found ? (
              <p className="flex items-center gap-2 text-muted" role="status">
                <SpinnerIcon size={16} className="animate-spin" aria-hidden />
                {progress ? t.redact.reading(progress[0], progress[1]) : t.redact.starting}
              </p>
            ) : !all.length ? (
              <p className="text-muted" role="status" data-testid="auto-redact-none">{t.redact.none}</p>
            ) : (
              <div className="-mx-1 flex min-h-0 flex-col gap-3 overflow-y-auto px-1" data-testid="auto-redact-list">
                <p className="text-xs text-muted">{t.redact.intro}</p>
                {found.map((p) => (
                  <section key={p.pageKey} className="flex flex-col gap-1">
                    <h3 className="text-2xs font-medium uppercase tracking-[0.12em] text-faint">{t.pages.pageN(p.number)}</h3>
                    {p.items.map((f) => (
                      <label key={f.key} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-hover">
                        <input type="checkbox" checked={!off.has(f.key)} onChange={() => toggle(f.key)} />
                        <span className="w-24 shrink-0 text-xs text-muted">{t.redact.kinds[f.kind]}</span>
                        <span className="min-w-0 truncate font-mono text-xs text-ink">{f.text}</span>
                      </label>
                    ))}
                  </section>
                ))}
              </div>
            )}
            <p className="text-2xs text-faint">{t.redact.scanNote}</p>
            <div className="flex items-center justify-end gap-2">
              <button type="button" className={BTN_QUIET} onClick={close}>{t.pages.cancel}</button>
              {found && all.length > 0 && (
                <button type="button" className={BTN_PRIMARY} disabled={!chosen.length} onClick={apply}>{t.redact.apply(chosen.length)}</button>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
