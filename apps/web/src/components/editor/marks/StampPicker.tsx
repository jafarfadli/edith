"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { StampAdd } from "@edith/ops";
import { fontStore } from "@/lib/fonts";
import { newId } from "@/lib/id";
import { STAMP_COLORS, STAMP_FONT, STAMPS_EN, STAMPS_ID, stampDate, stampRect, stampTime, type StampKind } from "@/lib/stamps";
import { t } from "@/lib/strings";
import { ICON } from "../../ui/icon";
import { BACKDROP, BTN_ICON, BTN_PRIMARY, DIALOG, DIALOG_TITLE, SEGMENTED, segment, swatch } from "../../ui/styles";
import { currentPage, placeObject } from "../placement";

/** Puts a stamp of `kind` in the middle of the page in view, selected (never wider than the page). */
export async function placeStamp(kind: StampKind, color: string): Promise<void> {
  const metrics = await fontStore.load(STAMP_FONT);
  const at = currentPage();
  if (!at) return;
  const op: StampAdd = { id: newId(), type: "stamp.add", pageKey: at.entry.pageKey, rect: stampRect(kind, metrics, at.size), color, ...kind };
  placeObject(op);
}

/** Stamp chooser: the presets (Indonesian or English), or a custom text with optional date/time in one of 5 colors. */
export function StampPicker({ onClose }: { onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { box.current?.focus(); }, []);
  const [tab, setTab] = useState<"presets" | "custom">("presets");
  const [lang, setLang] = useState<"id" | "en">("id");
  const [text, setText] = useState("");
  const [withDate, setWithDate] = useState(true);
  const [withTime, setWithTime] = useState(false);
  const [color, setColor] = useState<string>(STAMP_COLORS[0]);

  function pick(kind: StampKind, c: string) {
    onClose();
    placeStamp(kind, c).catch((e) => console.warn("stamp: font load failed", e));
  }

  function addCustom() {
    if (!text.trim()) return;
    const now = new Date();
    pick({ custom: { text: text.trim(), date: withDate ? stampDate(now) : null, time: withTime ? stampTime(now) : null } }, color);
  }

  return (
    <div className={`${BACKDROP} items-start pt-24`} onPointerDown={onClose}>
      <div ref={box} tabIndex={-1} role="dialog" aria-label={t.stamp.title} data-testid="stamp-picker" onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") onClose(); }}
        className={`${DIALOG} w-[34rem] max-w-[calc(100vw-2rem)] gap-4 p-4`}>
        <div className="flex items-center gap-2">
          <span className={DIALOG_TITLE}>{t.stamp.title}</span>
          <div className="flex-1" />
          <div role="tablist" className={SEGMENTED}>
            {(["presets", "custom"] as const).map((k) => (
              <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                className={segment(tab === k)}>{k === "presets" ? t.stamp.presets : t.stamp.custom}</button>
            ))}
          </div>
          <button aria-label={t.editor.close} onClick={onClose} className={BTN_ICON}><X {...ICON} /></button>
        </div>
        {tab === "presets" ? (
          <>
            <div role="radiogroup" aria-label={t.stamp.langLabel} className={`mb-3 w-fit ${SEGMENTED}`}>
              {(["id", "en"] as const).map((l) => (
                <button key={l} role="radio" aria-checked={lang === l} onClick={() => setLang(l)}
                  className={segment(lang === l)}>{l === "id" ? t.stamp.langId : t.stamp.langEn}</button>
              ))}
            </div>
            {/* Previews on paper, in the stamp's own colour: as they will look on the page. */}
            <div className="grid grid-cols-3 gap-2 rounded-lg bg-paper p-2">
              {(lang === "id" ? STAMPS_ID : STAMPS_EN).map((p) => (
                <button key={p.id} aria-label={p.label} onClick={() => pick({ preset: p.id as StampAdd["preset"] }, p.color)}
                  className="flex min-h-9 items-center justify-center rounded-md border-2 px-2 py-1 text-center text-xs font-bold leading-tight transition-transform hover:scale-[1.03]" style={{ borderColor: p.color, color: p.color }}>
                  {p.label}
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-3 text-sm">
            <input aria-label={t.stamp.text} value={text} maxLength={60} autoFocus onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addCustom(); }}
              className="h-10 rounded-md border border-line-strong bg-paper px-2 text-base font-bold focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" style={{ color }} />
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-1.5 text-muted"><input type="checkbox" checked={withDate} onChange={(e) => setWithDate(e.target.checked)} />{t.stamp.date}</label>
              <label className="flex items-center gap-1.5 text-muted"><input type="checkbox" checked={withTime} onChange={(e) => setWithTime(e.target.checked)} />{t.stamp.time}</label>
              <div className="flex-1" />
              <div role="radiogroup" aria-label={t.editor.color} className="flex gap-2">
                {STAMP_COLORS.map((c) => (
                  <button key={c} role="radio" aria-checked={color === c} aria-label={`${t.editor.color} ${c}`} onClick={() => setColor(c)}
                    className={swatch(color === c)} style={{ background: c }} />
                ))}
              </div>
            </div>
            <button onClick={addCustom} disabled={!text.trim()} className={`${BTN_PRIMARY} self-end`}>{t.stamp.add}</button>
          </div>
        )}
      </div>
    </div>
  );
}
