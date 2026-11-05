import type { FormField } from "@/lib/api";
import type { FormValue } from "@/store/editor";

const EDITABLE = new Set<FormField["type"]>(["text", "checkbox", "radio", "combo", "list"]);

/** Fields the form layer shows an input for (push buttons and signature fields are left to the PDF). */
export function isEditable(f: FormField): boolean {
  return EDITABLE.has(f.type) && !f.readOnly;
}

/** The value of field `f` the editor shows: what the user set, else the PDF's. Text/choice → string,
 *  checkbox → boolean, radio → the group's chosen on-state ("Off" when none). */
export function fieldValue(f: FormField, forms: Record<string, FormValue> | undefined, all: FormField[]): FormValue {
  const set = forms?.[f.name];
  if (set !== undefined) return set;
  if (f.type === "checkbox") return f.onState !== null && f.value === f.onState;
  if (f.type === "radio") return all.find((w) => w.name === f.name && w.type === "radio" && w.onState !== null && w.value === w.onState)?.onState ?? "Off";
  return f.value;
}

/** Font size (pt) of a field's input: the PDF's, else one that fits a single line (12 pt in multi-line fields). */
export function fieldFontSize(f: FormField): number {
  if (f.fontSize > 0) return f.fontSize;
  return f.multiline ? 12 : Math.max(6, Math.min(f.rect.h * 0.65, 14));
}
