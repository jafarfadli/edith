/**
 * Identity-edit harness (audit, M5b). For every editable paragraph of every reference PDF it builds the
 * text.edit op exactly as the web editor does when a paragraph is opened (paragraphStartBox =
 * prepareRuns + paragraphBox) and committed (commitEditing: normalizeRuns -> resolveLoadedRuns ->
 * relayout -> keepBaseline), WITHOUT changing the text, bakes it through the API (POST export, one page
 * via pages.layout) and saves the exported PDF + op JSON for compare.py.
 *
 * Env: EDITH_API (default http://127.0.0.1:19400), REFS (dir of PDFs, default <repo>/references), OUT (output
 * dir), ONLY (substring of a PDF name, optional), PARA (page:gid filter, optional), EDIT_MODE (identity | typo:
 * insert "x" after the first word, to see re-wrapping). Not MODE: vitest sets process.env.MODE = "test".
 * Run: see run.sh (vitest from apps/web with harness/vitest.config.mts).
 */
import { test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { Run, TextBox } from "@edith/ops";
import type { Paragraph, TextData } from "@/lib/api";
import { FontStore } from "@/lib/fonts";
import { documentScript, prepareRuns, resolveLoadedRuns, type FontTable } from "@/lib/fallback";
import { paragraphBox, paragraphWidth, hardBreaks } from "@/lib/paragraphs";
import { normalizeRuns } from "@/lib/runs";
import { relayout } from "@/lib/textbox";

const API = (process.env.EDITH_API || "http://127.0.0.1:19400").replace(/\/+$/, "");
const REFS = process.env.REFS || path.resolve(process.cwd(), "../../references");
const OUT = process.env.OUT || "/private/tmp/claude-501/audit3/out";
const ONLY = process.env.ONLY || "";
const PARA = process.env.PARA || "";
/** identity (default): commit unchanged. typo: insert one "x" at the end of the paragraph's first word (a real edit). */
const MODE = process.env.EDIT_MODE || "identity";
// vitest runs from apps/web (see run.sh): bundled fonts are its public/fonts (npm run sync-fonts).
const WEB_FONTS = process.env.WEB_FONTS || path.resolve(process.cwd(), "public/fonts");

// Bundled fonts from disk (the browser fetches /fonts/... from Next's public dir).
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
  const u = String(url);
  if (u.startsWith("disk-fonts/")) return new Response(fs.readFileSync(path.join(WEB_FONTS, u.slice("disk-fonts/".length))));
  return realFetch(url, init);
}) as typeof fetch;

/** commitEditing's keepBaseline (apps/web/src/components/editor/text/textEdit.ts), copied: it is module-private. */
function keepBaseline(start: TextBox, box: TextBox): TextBox {
  const before = start.layout[0]?.baseline, after = box.layout[0]?.baseline;
  if (before === undefined || after === undefined) return box;
  return { ...box, rect: { ...box.rect, y: start.rect.y + before - after } };
}

async function upload(file: string): Promise<string> {
  const fd = new FormData();
  fd.append("file", new Blob([fs.readFileSync(file)], { type: "application/pdf" }), path.basename(file));
  const r = await realFetch(`${API}/documents`, { method: "POST", body: fd });
  if (!r.ok) throw new Error(`upload ${file}: ${r.status}`);
  return (await r.json()).doc_id;
}

test("identity edits", async () => {
  const pdfs = fs.readdirSync(REFS).filter((f) => f.toLowerCase().endsWith(".pdf") && f.includes(ONLY)).sort();
  for (const name of pdfs) {
    const slug = name.replace(/\.pdf$/i, "").replace(/[^A-Za-z0-9]+/g, "_");
    const dir = path.join(OUT, slug);
    fs.mkdirSync(dir, { recursive: true });
    const docId = await upload(path.join(REFS, name));
    const data = (await (await realFetch(`${API}/documents/${docId}/text`)).json()) as TextData & { paragraphsVersion: number };
    fs.writeFileSync(path.join(dir, "text.json"), JSON.stringify(data));
    const fonts: FontTable = {};
    for (const f of data.fonts) fonts[f.ref] = f;
    const store = new FontStore("disk-fonts");
    store.setOriginalSource((f) => `${API}/documents/${docId}/fonts/${f.ref}`);
    store.setHanScript(documentScript(data.pages.flatMap((p) => p.paragraphs.flatMap((g) => g.runs.map((r) => r.text)))));
    const index: unknown[] = [];
    for (const page of data.pages) {
      if (!PARA || PARA.startsWith(`${page.index}:`)) {
        // Baseline: the same page exported with no edit (what the bake changes anyway: fonts, forms …).
        const layout = { id: "L", type: "pages.layout", pages: [{ pageKey: `o${page.index}`, src: { doc: docId, index: page.index } }] };
        const res = await realFetch(`${API}/documents/${docId}/export`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ ops: [layout], paragraphs_version: data.paragraphsVersion, filename: "x.pdf" }),
        });
        if (res.ok) fs.writeFileSync(path.join(dir, `p${page.index}_null.pdf`), Buffer.from(await res.arrayBuffer()));
      }
      for (const p of page.paragraphs as Paragraph[]) {
        if (PARA && PARA !== `${page.index}:${p.id}`) continue;
        const rec: Record<string, unknown> = { pdf: name, slug, page: page.index, id: p.id, editable: p.editable };
        index.push(rec);
        if (!p.editable) continue;
        try {
          // paragraphStartBox
          const [runs] = await prepareRuns([p.runs], fonts, store, store);
          const metricsFor = (f: Parameters<typeof store.get>[0]) => store.get(f);
          const start = paragraphBox({ ...p, runs }, metricsFor);
          // commitEditing (text unchanged; the real UI would skip the op, so this is "edit with no visible change")
          let edited = start.paragraphs;
          if (MODE === "typo") {
            const first = edited[0];
            const k = first.findIndex((r) => /\S/.test(r.text));
            if (k >= 0) {
              const m = /\S+/.exec(first[k].text)!;
              const at = m.index + m[0].length;
              edited = [first.map((r, i) => (i === k ? { ...r, text: r.text.slice(0, at) + "x" + r.text.slice(at) } : r)), ...edited.slice(1)];
            }
          }
          const normalized = edited.map(normalizeRuns);
          const ready = resolveLoadedRuns(normalized, fonts, (f) => store.peek(f), store);
          if (!ready) throw new Error("fallback not loaded");
          const box = keepBaseline(start, relayout({ ...start, paragraphs: ready }, metricsFor));
          const width = paragraphWidth({ ...p, runs }, metricsFor);
          rec.width = width;
          rec.breaks = hardBreaks({ ...p, runs }, Math.max(width, p.lines.length === 1 && p.align === "left" && p.maxWidth ? p.maxWidth + 0.01 : 0), metricsFor);
          rec.substituted = runs.some((r: Run) => r.font.kind !== "original") || runs.length !== p.runs.length;
          const op = { id: `e_${page.index}_${p.id}`, type: "text.edit", pageKey: `o${page.index}`, paragraphId: p.id, box };
          const layout = { id: "L", type: "pages.layout", pages: [{ pageKey: `o${page.index}`, src: { doc: docId, index: page.index } }] };
          const res = await realFetch(`${API}/documents/${docId}/export`, {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ ops: [layout, op], paragraphs_version: data.paragraphsVersion, filename: "x.pdf" }),
          });
          const stem = `p${page.index}_${p.id}`;
          fs.writeFileSync(path.join(dir, `${stem}.op.json`), JSON.stringify({ paragraph: p, op }));
          if (!res.ok) { rec.error = `export ${res.status}: ${await res.text()}`; continue; }
          fs.writeFileSync(path.join(dir, `${stem}.pdf`), Buffer.from(await res.arrayBuffer()));
          rec.out = `${stem}.pdf`;
        } catch (e) {
          rec.error = String(e);
        }
      }
    }
    fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify(index, null, 1));
    console.log(name, docId, index.length, "paragraphs");
  }
}, 3_600_000);
