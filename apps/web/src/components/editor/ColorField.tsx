"use client";

const SWATCHES = ["#111111", "#ffffff", "#e11d48", "#f59e0b", "#16a34a", "#2563eb", "#7c3aed"];

export function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-muted">
      {label}
      <input type="color" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="h-7 w-8 cursor-pointer rounded border border-line bg-transparent p-0.5" />
      <span className="hidden gap-0.5 xl:flex">
        {SWATCHES.map((c) => (
          <button key={c} type="button" aria-label={`${label} ${c}`} onClick={() => onChange(c)}
            className={`h-4 w-4 rounded-full ring-1 ring-line ${value.toLowerCase() === c ? "outline outline-2 outline-accent" : ""}`} style={{ background: c }} />
        ))}
      </span>
    </label>
  );
}
