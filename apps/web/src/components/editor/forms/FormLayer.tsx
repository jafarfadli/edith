"use client";

import type { FormField } from "@/lib/api";
import { toScreen, type PageGeom } from "@/lib/coords";
import { fieldFontSize, fieldValue, isEditable } from "@/lib/forms";
import { editorStore, useEditor } from "@/store/editor";

const NONE: FormField[] = [];
/** Opaque, so the widget's own appearance (drawn by pdf.js on the canvas) never shows through twice. */
const FIELD_BG = "#eef4ff";

/** HTML inputs over the AcroForm widgets of a page; their values are form.set ops (one undo step per
 *  field while typing). Inputs take the pointer only with the select tool, so other tools draw over fields. */
export function FormLayer({ pageKey, geom, scale }: { pageKey: string; geom: PageGeom; scale: number }) {
  const src = useEditor((s) => s.doc.pages.find((p) => p.pageKey === pageKey)?.src);
  const fields = useEditor((s) => s.info?.fields ?? NONE);
  const forms = useEditor((s) => s.doc.forms);
  const tool = useEditor((s) => s.tool);
  const docId = useEditor((s) => s.info?.docId);
  if (!src || !("doc" in src) || src.doc !== docId) return null; // fields of imported PDFs are not editable (yet)
  const mine = fields.filter((f) => f.page === src.index && isEditable(f));
  if (!mine.length) return null;

  const set = (f: FormField, value: string | boolean) =>
    editorStore.getState().setFormValue(f.name, value, f.type === "text" ? { coalesce: `form:${f.name}` } : undefined);

  return (
    <div className="absolute inset-0" style={{ pointerEvents: "none", zIndex: 5 }} data-testid="form-layer">
      {mine.map((f, i) => {
        const [left, top] = toScreen([f.rect.x, f.rect.y], geom, scale);
        const value = fieldValue(f, forms, fields);
        const style: React.CSSProperties = {
          position: "absolute", left, top, width: f.rect.w * scale, height: f.rect.h * scale,
          transform: `rotate(${geom.rotation}deg)`, transformOrigin: "top left",
          pointerEvents: tool === "select" ? "auto" : "none",
          fontSize: fieldFontSize(f) * scale, background: FIELD_BG, boxSizing: "border-box",
        };
        const common = { "aria-label": f.name, "data-field": f.name, style, className: "border border-accent/40 px-1 text-ink outline-none focus:border-accent" };
        switch (f.type) {
          case "text":
            return f.multiline
              ? <textarea key={i} {...common} value={value as string} onChange={(e) => set(f, e.target.value)} className={`${common.className} resize-none`} />
              : <input key={i} {...common} value={value as string} onChange={(e) => set(f, e.target.value)} />;
          case "checkbox":
            return (
              <span key={i} style={{ ...style, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <input type="checkbox" aria-label={f.name} data-field={f.name} checked={value === true} onChange={(e) => set(f, e.target.checked)}
                  style={{ width: "80%", height: "80%", margin: 0 }} />
              </span>
            );
          case "radio":
            return (
              <span key={i} style={{ ...style, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <input type="radio" name={`${pageKey}:${f.name}`} aria-label={`${f.name} ${f.onState}`} data-field={f.name}
                  checked={value === f.onState} onChange={() => set(f, f.onState!)} style={{ width: "80%", height: "80%", margin: 0 }} />
              </span>
            );
          default: // combo, list
            return (
              <select key={i} {...common} size={f.type === "list" ? Math.max(2, f.options?.length ?? 2) : undefined}
                value={value as string} onChange={(e) => set(f, e.target.value)}>
                {!f.options?.includes(value as string) && <option value={value as string}>{value as string}</option>}
                {f.options?.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            );
        }
      })}
    </div>
  );
}
