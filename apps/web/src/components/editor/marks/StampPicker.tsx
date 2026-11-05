"use client";

import { useEffect, useRef, useState } from "react";
import type { StampAdd } from "@edith/ops";
import { fontStore } from "@/lib/fonts";
import { newId } from "@/lib/id";
import { STAMP_COLORS, STAMP_FONT, STAMPS_EN, STAMPS_ID, stampDate, stampRect, stampTime, type StampKind } from "@/lib/stamps";
import { t } from "@/lib/strings";
import { currentPage, placeObject } from "../placement";

/** Puts a stamp of `kind` in the middle of the page in view, selected (never wider than the page). */
export async function placeStamp(kind: StampKind, color: string): Promise<void> {
  const metrics = await fontStore.load(STAMP_FONT);
  const at = currentPage();
  if (!at) return;
  const op: StampAdd = { id: newId(), type: "stamp.add", pageKey: at.entry.pageKey, rect: stampRect(kind, metrics, at.geom), color, ...kind };
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
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/20 pt-24" onPointerDown={onClose}>
      <div ref={box} tabIndex={-1} role="dialog" aria-label={t.stamp.title} data-testid="stamp-picker" onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") onClose(); }}
        className="w-[34rem] rounded-xl outline-none bg-surface p-4 shadow-xl ring-1 ring-line">
        <div className="mb-3 flex items-center gap-2">
          <span className="font-medium">{t.stamp.title}</span>
          <div className="flex-1" />
          <div role="tablist" className="flex rounded-md ring-1 ring-line text-sm">
            {(["presets", "custom"] as const).map((k) => (
              <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                className={`px-3 py-1 ${tab === k ? "bg-accent/10 text-accent" : "hover:bg-bg"}`}>{k === "presets" ? t.stamp.presets : t.stamp.custom}</button>
            ))}
          </div>
          <button aria-label={t.editor.close} onClick={onClose} className="rounded-md px-2 py-1 hover:bg-bg">✕</button>
        </div>
        {tab === "presets" ? (
          <>
            <div role="radiogroup" aria-label={t.stamp.langLabel} className="mb-2 flex w-fit rounded-md ring-1 ring-line text-sm">
              {(["id", "en"] as const).map((l) => (
                <button key={l} role="radio" aria-checked={lang === l} onClick={() => setLang(l)}
                  className={`px-3 py-1 ${lang === l ? "bg-accent/10 text-accent" : "hover:bg-bg"}`}>{l === "id" ? t.stamp.langId : t.stamp.langEn}</button>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {(lang === "id" ? STAMPS_ID : STAMPS_EN).map((p) => (
                <button key={p.id} aria-label={p.label} onClick={() => pick({ preset: p.id as StampAdd["preset"] }, p.color)}
                  className="rounded-md border-2 px-2 py-1.5 text-xs font-bold hover:bg-bg" style={{ borderColor: p.color, color: p.color }}>
                  {p.label}
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-3 text-sm">
            <input aria-label={t.stamp.text} value={text} maxLength={60} autoFocus onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addCustom(); }}
              className="rounded border border-line px-2 py-1.5 font-bold" style={{ color }} />
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-1"><input type="checkbox" checked={withDate} onChange={(e) => setWithDate(e.target.checked)} />{t.stamp.date}</label>
              <label className="flex items-center gap-1"><input type="checkbox" checked={withTime} onChange={(e) => setWithTime(e.target.checked)} />{t.stamp.time}</label>
              <div className="flex-1" />
              <div role="radiogroup" aria-label={t.editor.color} className="flex gap-1">
                {STAMP_COLORS.map((c) => (
                  <button key={c} role="radio" aria-checked={color === c} aria-label={`${t.editor.color} ${c}`} onClick={() => setColor(c)}
                    className={`h-6 w-6 rounded-full ring-1 ring-line ${color === c ? "outline outline-2 outline-accent" : ""}`} style={{ background: c }} />
                ))}
              </div>
            </div>
            <button onClick={addCustom} disabled={!text.trim()} className="self-end rounded-md bg-accent px-3 py-1.5 text-accent-ink disabled:opacity-50">{t.stamp.add}</button>
          </div>
        )}
      </div>
    </div>
  );
}
