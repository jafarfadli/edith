import type { EditorDoc, StructurePage } from "@/store/editor";

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function validSrc(src: unknown): boolean {
  if (typeof src !== "object" || src === null) return false;
  const s = src as Record<string, unknown>;
  if ("doc" in s) return typeof s.doc === "string" && Number.isInteger(s.index) && (s.index as number) >= 0;
  const b = s.blank as Record<string, unknown> | null | undefined;
  return typeof b === "object" && b !== null && isNum(b.width) && isNum(b.height);
}

/** Form values of a draft: a plain object of string/boolean values (M1/M2 drafts have none). */
function validForms(forms: unknown): Record<string, string | boolean> {
  if (typeof forms !== "object" || forms === null || Array.isArray(forms)) return {};
  return Object.fromEntries(Object.entries(forms).filter(([, v]) => typeof v === "string" || typeof v === "boolean"));
}

/** Doc ids of imported PDFs recorded in a draft (M4+; none before). */
function validImports(imports: unknown): string[] {
  return Array.isArray(imports) ? imports.filter((v): v is string => typeof v === "string") : [];
}

/** A stored draft for the re-opened document `docId`: pages of the main document get the new doc id (a
 *  re-upload of the same file has a new one); pages of imported PDFs keep theirs (see resolveImports). */
export function restoreDraft(draft: EditorDoc | null, docId: string, pageCount: number): EditorDoc | null {
  if (!draft || !Array.isArray(draft.pages) || draft.pages.length === 0) return null;
  const imports = validImports(draft.imports);
  const pages = [];
  for (const p of draft.pages) {
    if (typeof p !== "object" || p === null || !validSrc(p.src)) return null;
    if ("doc" in p.src && imports.includes(p.src.doc)) {
      pages.push(p);
    } else if ("doc" in p.src) {
      if (p.src.index >= pageCount) return null;
      pages.push({ ...p, src: { doc: docId, index: p.src.index } });
    } else {
      pages.push(p);
    }
  }
  return { ...draft, pages, forms: validForms(draft.forms), imports };
}

/** Page sizes of the imported PDFs a restored draft uses. Pages of imports that are gone (expired) or whose
 *  index no longer exists are dropped; `missing` says whether any were; `doc` is null when no page is left. */
export async function resolveImports(
  doc: EditorDoc,
  structure: (docId: string) => Promise<StructurePage[]>,
): Promise<{ doc: EditorDoc | null; imports: Record<string, StructurePage[]>; missing: boolean }> {
  const used = [...new Set(doc.pages.flatMap((p) => ("doc" in p.src && doc.imports?.includes(p.src.doc) ? [p.src.doc] : [])))];
  const imports: Record<string, StructurePage[]> = {};
  await Promise.all(used.map(async (id) => {
    try { imports[id] = await structure(id); } catch { /* expired or unknown: its pages go */ }
  }));
  const pages = doc.pages.filter((p) => !("doc" in p.src) || !doc.imports?.includes(p.src.doc) || p.src.index < (imports[p.src.doc]?.length ?? 0));
  const missing = pages.length !== doc.pages.length;
  return { doc: !pages.length ? null : missing ? { ...doc, pages } : doc, imports, missing };
}
