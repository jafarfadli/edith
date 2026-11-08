"use client";

import { PROP_LABEL, swatch } from "../ui/styles";

const SWATCHES = ["#111111", "#ffffff", "#e11d48", "#f59e0b", "#16a34a", "#2563eb", "#7c3aed"];

/** A colour chip (the native picker) plus, on wide screens and unless `compact`, a few swatches. */
export function ColorField({ label, value, onChange, compact = false }: { label: string; value: string; onChange: (v: string) => void; compact?: boolean }) {
  return (
    <label className={PROP_LABEL}>
      {label}
      <span className="relative h-6 w-6 shrink-0 overflow-hidden rounded-md ring-1 ring-inset ring-line-strong" style={{ background: value }}>
        <input type="color" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
      </span>
      <span className={compact ? "hidden" : "hidden gap-1 xl:flex"}>
        {SWATCHES.map((c) => (
          <button key={c} type="button" aria-label={`${label} ${c}`} onClick={() => onChange(c)}
            className={swatch(value.toLowerCase() === c)} style={{ background: c }} />
        ))}
      </span>
    </label>
  );
}
