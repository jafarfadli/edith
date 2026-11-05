# Task 12: Form layer (HTML inputs over AcroForm widgets) and the flatten toggle

Each page gets HTML inputs over its widgets (text, multi-line text, checkbox, radio, combo, list; buttons, signature fields and read-only fields are left to the PDF), positioned like the M2 rich editor (`toScreen` of the top-left corner + CSS rotation). They are opaque so the widget appearance pdf.js draws on the canvas never shows twice (spike: `AnnotationMode.ENABLE_FORMS` hides text/choice widgets but would draw *both* states of checkboxes/radios onto the main canvas without an annotation layer, so the default mode stays). Inputs take the pointer only with the select tool. Values go to `EditorDoc.forms` (undoable; typing in one field is one step) and are exported as `form.set`. The header shows **Ratakan form** (off by default) only when the document has fields.

**Files:**
- Modify: `apps/web/src/components/editor/Editor.tsx`
- Modify: `apps/web/src/components/editor/Header.tsx`
- Create: `apps/web/src/components/editor/forms/FormLayer.tsx`
- Create: `apps/web/src/lib/forms.test.ts`
- Create: `apps/web/src/lib/forms.ts`

**Interfaces:**
- Consumes: Task 4 structure `fields`; Task 6 `FormField`, `DocInfo.fields`, `setFormValue`, `doc.forms`, `t.form`.
- Produces:
  - `lib/forms.ts`: `isEditable(field)`, `fieldValue(field, forms, all) -> FormValue` (radio: the group's chosen on-state, `"Off"` when none), `fieldFontSize(field)`.
  - `components/editor/forms/FormLayer.tsx`: `FormLayer({pageKey, geom, scale})` (`data-testid="form-layer"`; each input's accessible name is the field name, radios `"<name> <onState>"`).
  - `Editor` passes `fields` into `DocInfo` and renders `FormLayer` in the page overlay; `Header` sends `flatten_forms`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/lib/forms.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { FormField } from "@/lib/api";
import { fieldFontSize, fieldValue, isEditable } from "@/lib/forms";

const field = (p: Partial<FormField>): FormField => ({
  name: "f", type: "text", value: "", onState: null, options: null, page: 0, rect: { x: 0, y: 0, w: 100, h: 20 },
  readOnly: false, multiline: false, fontSize: 0, ...p,
});

describe("forms", () => {
  const merah = field({ name: "warna", type: "radio", value: "Off", onState: "Merah" });
  const biru = field({ name: "warna", type: "radio", value: "Biru", onState: "Biru" });
  const all = [merah, biru];

  it("shows the PDF's value until the user sets one", () => {
    expect(fieldValue(field({ value: "awal" }), undefined, [])).toBe("awal");
    expect(fieldValue(field({ value: "awal" }), { f: "baru" }, [])).toBe("baru");
    expect(fieldValue(field({ type: "checkbox", value: "Yes", onState: "Yes" }), {}, [])).toBe(true);
    expect(fieldValue(field({ type: "checkbox", value: "Off", onState: "Yes" }), {}, [])).toBe(false);
    expect(fieldValue(field({ type: "checkbox", value: "Off", onState: "Yes" }), { f: true }, [])).toBe(true);
  });

  it("reads a radio group's value from the chosen button", () => {
    expect(fieldValue(merah, {}, all)).toBe("Biru");
    expect(fieldValue(merah, { warna: "Merah" }, all)).toBe("Merah");
    expect(fieldValue(merah, {}, [merah, { ...biru, value: "Off" }])).toBe("Off");
  });

  it("knows which fields get an input and their font size", () => {
    expect([isEditable(field({})), isEditable(field({ type: "button" })), isEditable(field({ readOnly: true }))]).toEqual([true, false, false]);
    expect(fieldFontSize(field({ fontSize: 11 }))).toBe(11);
    expect(fieldFontSize(field({}))).toBe(13);
    expect(fieldFontSize(field({ multiline: true, rect: { x: 0, y: 0, w: 100, h: 60 } }))).toBe(12);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd apps/web && npx vitest run src/lib/forms.test.ts`
Expected: `Cannot find module '@/lib/forms'`.

- [ ] **Step 3: Implement**

Modify `apps/web/src/components/editor/Editor.tsx` (unified diff; the `-`/`+` lines are exact, apply by hand or with `git apply`):
```diff
--- a/apps/web/src/components/editor/Editor.tsx
+++ b/apps/web/src/components/editor/Editor.tsx
@@ -16,6 +16,7 @@ import { createDebounced } from "@/lib/autosave";
 import { boxFonts } from "@/lib/textbox";
 import { editorStore, pageGeom, useEditor, type EditorDoc } from "@/store/editor";
 import { textStore } from "@/store/text";
+import { FormLayer } from "./forms/FormLayer";
 import { Header } from "./Header";
 import { Notice } from "./Notice";
 import { PageList } from "./PageList";
@@ -59,7 +60,7 @@ export function Editor({ docId, initialName }: { docId: string; initialName: str
       }
       if (cancelled) return;
       const draft = restoreDraft(loadDraft(st.sha256), docId, st.page_count);
-      editorStore.getState().init({ docId, sha256: st.sha256, fileName: initialName, pages: st.pages }, draft);
+      editorStore.getState().init({ docId, sha256: st.sha256, fileName: initialName, pages: st.pages, fields: st.fields }, draft);
       initialDoc.current = editorStore.getState().doc;
       if (draft) setNotice({ kind: "info", text: t.editor.restored });
       void textStore.getState().load(docId); // original paragraphs + fonts, in the background
@@ -156,7 +157,7 @@ export function Editor({ docId, initialName }: { docId: string; initialName: str
           }}
           onPointerUp={() => { drag.current = null; }}
         >
-          {info && pdf ? <PageList pdf={pdf} overlay={(a) => <><PageOverlay {...a} /><TextEditor {...a} /><LinkPopover {...a} /></>} /> : <p className="p-8 text-muted" role="status">{t.upload.processing}</p>}
+          {info && pdf ? <PageList pdf={pdf} overlay={(a) => <><PageOverlay {...a} /><FormLayer {...a} /><TextEditor {...a} /><LinkPopover {...a} /></>} /> : <p className="p-8 text-muted" role="status">{t.upload.processing}</p>}
         </main>
       </div>
       <FindBar />
```

Modify `apps/web/src/components/editor/Header.tsx` (unified diff; the `-`/`+` lines are exact, apply by hand or with `git apply`):
```diff
--- a/apps/web/src/components/editor/Header.tsx
+++ b/apps/web/src/components/editor/Header.tsx
@@ -14,6 +14,8 @@ export function Header({ onNotice }: { onNotice: (n: { kind: "error" | "info"; t
   const info = useEditor((s) => s.info);
   const [name, setName] = useState<string | null>(null);
   const [busy, setBusy] = useState(false);
+  const [flatten, setFlatten] = useState(false);
+  const hasForm = useEditor((s) => (s.info?.fields?.length ?? 0) > 0);
   const fileName = name ?? info?.fileName ?? "document.pdf";
 
   async function download() {
@@ -26,7 +28,7 @@ export function Header({ onNotice }: { onNotice: (n: { kind: "error" | "info"; t
       s = editorStore.getState();
       if (!s.info) return;
       sent = compact(s.doc);
-      const blob = await exportPdf(s.info.docId, { ops: sent, flatten_forms: false, filename: fileName });
+      const blob = await exportPdf(s.info.docId, { ops: sent, flatten_forms: hasForm && flatten, filename: fileName });
       downloadBlob(blob, fileName.toLowerCase().endsWith(".pdf") ? fileName : `${fileName}.pdf`);
     } catch (e) {
       const err = e instanceof ApiError ? e : new ApiError("generic", 0);
@@ -55,6 +57,12 @@ export function Header({ onNotice }: { onNotice: (n: { kind: "error" | "info"; t
       <button onClick={openFind} disabled={!info} className="rounded-lg px-3 py-2 text-sm hover:bg-bg disabled:opacity-60">
         🔍 {t.find.open}
       </button>
+      {hasForm && (
+        <label className="flex items-center gap-1.5 text-sm" title={t.form.flattenHint}>
+          <input type="checkbox" checked={flatten} onChange={(e) => setFlatten(e.target.checked)} />
+          {t.form.flatten}
+        </label>
+      )}
       <button
         onClick={download}
         disabled={busy || !info}
```

Create `apps/web/src/components/editor/forms/FormLayer.tsx`:
```tsx
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
  if (!src || !("doc" in src)) return null;
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
```

Create `apps/web/src/lib/forms.ts`:
```ts
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
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd apps/web && npx vitest run src/lib/forms.test.ts`
Expected: `Tests  3 passed (3)`.

- [ ] **Step 5: Full check**

Run: `npm test -w apps/web && npx tsc --noEmit -p apps/web && npm run lint -w apps/web`
Expected: `Tests  204 passed (204)`; tsc prints nothing; eslint reports no problems. API untouched (`cd apps/api && uv run pytest -q` still `295 passed`).

- [ ] **Step 6: Try it in the browser**

Generate a form PDF: `cd apps/api && uv run python -c "from tests.pdfs import make_form_pdf; open('/tmp/form.pdf','wb').write(make_form_pdf())"`. Upload it: inputs appear over the fields; type a name, tick the checkbox, pick "Biru", choose "Bandung"; Ctrl/Cmd+Z undoes the whole typed name at once. Download with and without **Ratakan form** and open both in a viewer.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/editor/Editor.tsx apps/web/src/components/editor/Header.tsx apps/web/src/components/editor/forms/FormLayer.tsx apps/web/src/lib/forms.test.ts apps/web/src/lib/forms.ts
git commit -m "feat(web): fill AcroForm fields in the editor and optionally flatten on export" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
