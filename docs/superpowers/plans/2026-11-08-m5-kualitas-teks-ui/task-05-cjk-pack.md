# Task 5: Optional CJK fallback pack, CJK substitutes, font subsetting at export

> Part of the M5 plan — read `README.md` in this folder first (Global Constraints, Decisions, Owner decisions). Code below was run in a throwaway worktree; modified files are unified diffs against the state the previous task leaves, new files are complete.

**Goal:** Characters an original subset lacks need a fallback that can draw them; nothing bundled has Hangul/kana/Han. Owner decision: Noto Sans/Serif KR, JP and SC (regular + bold) as an optional pack that is not committed: `packages/fonts/scripts/fetch-cjk.mjs` downloads it from the Google Fonts CSS API into `packages/fonts/files/cjk/` (gitignored, ±113 MB — more than the ~6 MB per file the owner expected: Noto Serif SC is 14.8 MB); the manifest lists it under `cjk` (separate from `families`, so the font picker does not offer it). `FontRegistry` only knows pack families whose files are there (`cjk(script, category)`); `cjk_style(name)` maps CJK font names to a script and design (Dotum/Gulim/Malgun/Gothic → sans, Batang/Myeongjo/Mincho/Song → serif; Korean → kr, Japanese → jp, Chinese incl. Traditional → sc) and `substitute()` uses it when the pack is there (Dotum → Noto Sans KR, Batang → Noto Serif KR), else the old flag-based fallback. TextWriter embeds whole font files (a CJK fallback is 4–15 MB), so the export now subsets fonts when the bake added any (`doc.subset_fonts()`, then `trim_to_unicode` drops the CMap entries of emptied glyphs: a Korean edit exports at ~100 KB instead of 3.2 MB). README, both Dockerfiles (`--build-arg CJK_FONTS=0` to skip) and CI (cached) fetch the pack. One E2E assertion changes: after subsetting MuPDF names the reused font after its family (`EdithDoc Regular`).

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `.gitignore`
- Modify: `README.md`
- Modify: `apps/api/Dockerfile`
- Modify: `apps/api/edith/bake/__init__.py`
- Modify: `apps/api/edith/bake/tounicode.py`
- Modify: `apps/api/edith/fonts.py`
- Modify: `apps/api/edith/routes/export.py`
- Modify: `apps/api/tests/pdfs.py`
- Modify: `apps/api/tests/test_export.py`
- Modify: `apps/api/tests/test_fonts.py`
- Modify: `apps/api/tests/test_text.py`
- Modify: `apps/web/Dockerfile`
- Modify: `apps/web/e2e/text.spec.ts`
- Modify: `packages/fonts/LICENSES.md`
- Modify: `packages/fonts/manifest.json`
- Create: `packages/fonts/scripts/fetch-cjk.mjs`

**Interfaces:**
- Consumes: Task 4 (`cid_fonts`, rebuilt originals).
- Produces: `fonts.cjk_style(name) -> (script, category) | None`; `FontRegistry.cjk(script, category) -> str | None`, `path()/font()/category()` also for pack families; manifest key `cjk: {family: {category, script, files}}`; `bake(..., subset_fonts=False)` (export passes True); `bake.tounicode.trim_to_unicode(doc, xref)`; `tests.pdfs.fake_cjk_pack(root, files=…)` (a fonts dir with Droid Sans Fallback as the pack, for hermetic tests); `node packages/fonts/scripts/fetch-cjk.mjs [--force]`.

- [ ] **Step 1: Write the failing tests**

Modify `apps/api/tests/pdfs.py`:

```diff
diff --git a/apps/api/tests/pdfs.py b/apps/api/tests/pdfs.py
index cacfc96..b5adbca 100644
--- a/apps/api/tests/pdfs.py
+++ b/apps/api/tests/pdfs.py
@@ -350,3 +350,16 @@ def make_cid_subset_pdf() -> bytes:
         name = next(n for n in ("Dotum", "Batang", "Wingdings") if n in basefont)
         doc.xref_set_key(xref, "BaseFont", f"/EDITHA+{name}")
     return doc.tobytes(garbage=3, deflate=True)
+
+
+def fake_cjk_pack(root: Path, files: tuple[str, ...] = ("NotoSansKR-Regular.ttf", "NotoSerifKR-Regular.ttf")) -> Path:
+    """A fonts dir at `root`: the real manifest and bundled files (symlinked) plus a fake CJK pack — the given pack
+    files, each a copy of Droid Sans Fallback (built into MuPDF: Hangul, kana, Han). Tests don't need the real pack."""
+    (root / "files" / "cjk").mkdir(parents=True)
+    (root / "manifest.json").write_bytes((FONT_FILES.parent / "manifest.json").read_bytes())
+    for f in FONT_FILES.glob("*.ttf"):
+        (root / "files" / f.name).symlink_to(f)
+    droid = pymupdf.Font("korea").buffer
+    for name in files:
+        (root / "files" / "cjk" / name).write_bytes(droid)
+    return root
```

Modify `apps/api/tests/test_export.py`:

```diff
diff --git a/apps/api/tests/test_export.py b/apps/api/tests/test_export.py
index 9efe6b2..4d3d509 100644
--- a/apps/api/tests/test_export.py
+++ b/apps/api/tests/test_export.py
@@ -160,3 +160,37 @@ def test_export_with_expired_import(client):
     r = client.post(f"/documents/{doc_id}/export", json={"ops": [layout]})
     assert r.status_code == 410
     assert r.json()["error"]["code"] == "doc_expired" and r.json()["error"]["doc_id"] == imported
+def text_add(text: str, family: str) -> dict:
+    run = {"text": text, "font": {"kind": "bundled", "family": family, "bold": False, "italic": False}, "size": 12,
+           "color": "#000000"}
+    return {"id": "t", "type": "text.add", "pageKey": "o0", "box": {
+        "rect": R(100, 200, 300, 20), "align": "left", "lineHeight": 14.4, "paragraphs": [[run]],
+        "layout": [{"baseline": 12, "segments": [{"x": 0, "text": text, "runIndex": 0}]}]}}
+
+
+def embedded(out: pymupdf.Document, name: str) -> bytes:
+    return next(out.extract_font(e[0])[3] for e in out[0].get_fonts(full=True) if name in e[3])
+
+
+def test_export_embeds_only_the_glyphs_it_uses(client):
+    doc_id = new_doc(client, pages=1)
+    r = client.post(f"/documents/{doc_id}/export", json={"ops": [text_add("Halo dunia", "Arimo")]})
+    out = pymupdf.open(stream=r.content, filetype="pdf")
+    assert "Halo dunia" in out[0].get_text()
+    assert len(embedded(out, "Arimo")) < 50_000  # Arimo-Regular.ttf is 316 KB
+
+
+def test_export_with_a_cjk_fallback_font_stays_small(tmp_path):
+    from fastapi.testclient import TestClient
+
+    from edith.main import create_app
+    from edith.settings import Settings
+    from tests.pdfs import fake_cjk_pack
+    settings = Settings(data_dir=tmp_path / "data", fonts_dir=fake_cjk_pack(tmp_path / "fonts"))
+    with TestClient(create_app(settings)) as c:
+        doc_id = new_doc(c, pages=1)
+        r = c.post(f"/documents/{doc_id}/export", json={"ops": [text_add("한국어 텍스트", "Noto Sans KR")]})
+    assert r.status_code == 200, r.text
+    out = pymupdf.open(stream=r.content, filetype="pdf")
+    assert "한국어 텍스트" in out[0].get_text()
+    assert len(r.content) < 100_000  # the fallback file is 4 MB
```

Modify `apps/api/tests/test_fonts.py`:

```diff
diff --git a/apps/api/tests/test_fonts.py b/apps/api/tests/test_fonts.py
index 2b295b0..a5ba244 100644
--- a/apps/api/tests/test_fonts.py
+++ b/apps/api/tests/test_fonts.py
@@ -3,8 +3,9 @@ import json
 import pymupdf
 import pytest
 
-from edith.fonts import STYLES, FontRegistry, UnknownFont, base_font_name, parse_font_name
+from edith.fonts import STYLES, FontRegistry, UnknownFont, base_font_name, cjk_style, parse_font_name
 from edith.settings import Settings
+from tests.pdfs import fake_cjk_pack
 
 
 @pytest.fixture
@@ -82,3 +83,48 @@ def test_name_parsing():
 ])
 def test_substitute(registry, name, flags, family, bold, italic):
     assert registry.substitute(name, flags) == {"kind": "bundled", "family": family, "bold": bold, "italic": italic}
+
+
+def test_cjk_manifest_entries():
+    manifest = json.loads((Settings().fonts_dir / "manifest.json").read_text())
+    assert set(manifest["cjk"]) == {f"Noto {d} {s}" for d in ("Sans", "Serif") for s in ("KR", "JP", "SC")}
+    for family, info in manifest["cjk"].items():
+        assert (info["category"], info["script"]) == ("serif" if "Serif" in family else "sans", family[-2:].lower())
+        assert set(info["files"]) == {"regular", "bold"}
+        assert all(f.startswith("cjk/") and f.endswith(".ttf") for f in info["files"].values())
+
+
+@pytest.mark.parametrize("name,style", [
+    ("INPILL+Dotum", ("kr", "sans")), ("DotumChe", ("kr", "sans")), ("Gulim", ("kr", "sans")),
+    ("Malgun Gothic,Bold", ("kr", "sans")), ("Haansoft Batang", ("kr", "serif")), ("HYMyeongJo-Medium", ("kr", "serif")),
+    ("MS-Mincho", ("jp", "serif")), ("MS PGothic", ("jp", "sans")), ("KozMinPr6N-Regular", ("jp", "serif")),
+    ("SimSun", ("sc", "serif")), ("Microsoft YaHei", ("sc", "sans")), ("PMingLiU", ("sc", "serif")),
+    ("NotoSansCJKjp-Regular", ("jp", "sans")), ("NotoSerifKR-Bold", ("kr", "serif")),
+    ("Arial", None), ("Century Gothic", None), ("Wingdings", None), ("TimesNewRomanPSMT", None),
+])
+def test_cjk_style(name, style):
+    assert cjk_style(name) == style
+
+
+def test_cjk_pack_present(tmp_path):
+    reg = FontRegistry(fake_cjk_pack(tmp_path / "fonts"))
+    assert (reg.cjk("kr", "sans"), reg.cjk("kr", "serif"), reg.cjk("kr", "mono")) == ("Noto Sans KR", "Noto Serif KR", "Noto Sans KR")
+    assert reg.cjk("jp", "sans") is None  # only the Korean files are there
+    assert reg.path("Noto Sans KR", True, False).name == "NotoSansKR-Regular.ttf"  # no bold file: regular
+    assert reg.font("Noto Serif KR", False, False).has_glyph(ord("한"))
+    assert reg.category("Noto Serif KR") == "serif"
+    assert reg.substitute("EDITHA+Dotum") == {"kind": "bundled", "family": "Noto Sans KR", "bold": False, "italic": False}
+    assert reg.substitute("Haansoft Batang", 4)["family"] == "Noto Serif KR"
+    assert reg.substitute("MS-Mincho", 4)["family"] == "Tinos"  # Japanese files missing: by flags as before
+    assert "Noto Sans KR" not in reg.families()  # pack families are fallbacks, not choices in the font picker
+
+
+def test_cjk_pack_absent(tmp_path):
+    root = tmp_path / "fonts"
+    (root / "files").mkdir(parents=True)
+    (root / "manifest.json").write_bytes((Settings().fonts_dir / "manifest.json").read_bytes())
+    reg = FontRegistry(root)
+    assert reg.cjk("kr", "sans") is None
+    assert reg.substitute("EDITHA+Dotum")["family"] == "Arimo"
+    with pytest.raises(UnknownFont):
+        reg.path("Noto Sans KR", False, False)
```

Modify `apps/api/tests/test_text.py`:

```diff
diff --git a/apps/api/tests/test_text.py b/apps/api/tests/test_text.py
index c77729c..33ed261 100644
--- a/apps/api/tests/test_text.py
+++ b/apps/api/tests/test_text.py
@@ -124,3 +124,15 @@ def test_font_bytes_headers_and_rejects_bad_refs(client):
     for bad in ("f", "f0x1", "F1", "f1234567890", "f１"):
         r = client.get(f"/documents/{body['doc_id']}/fonts/{bad}")
         assert r.status_code == 404 and r.json()["error"]["code"] == "font_not_found", bad
+
+
+def test_cjk_fonts_substitute_with_the_pack(tmp_path):
+    from fastapi.testclient import TestClient
+
+    from edith.main import create_app
+    from edith.settings import Settings
+    from tests.pdfs import fake_cjk_pack
+    settings = Settings(data_dir=tmp_path / "data", fonts_dir=fake_cjk_pack(tmp_path / "fonts"))
+    with TestClient(create_app(settings)) as c:
+        f = by_name(text_of(c, make_cid_subset_pdf()))
+    assert (f["Dotum"]["substitute"]["family"], f["Batang"]["substitute"]["family"]) == ("Noto Sans KR", "Noto Serif KR")
```

Modify `apps/web/e2e/text.spec.ts`:

```diff
diff --git a/apps/web/e2e/text.spec.ts b/apps/web/e2e/text.spec.ts
index 0a282db..b872835 100644
--- a/apps/web/e2e/text.spec.ts
+++ b/apps/web/e2e/text.spec.ts
@@ -82,7 +82,7 @@ test("edit an original paragraph, find & replace, download", async ({ page }) =>
   expect(bold.font).toMatch(/Arimo.*Bold/);
   expect(bold.text.trim()).toBe("penting");
   expect(spans.find((s) => s.text.includes("Paragraf pertama"))!.font).toMatch(/Arimo/);
-  expect(spans.find((s) => s.text.includes("Paragraf kedua"))!.font).toBe("EdithDoc-Regular");
+  expect(spans.find((s) => s.text.includes("Paragraf kedua"))!.font).toContain("EdithDoc"); // subset at export: MuPDF names it after the family
 
   // Unchanged text keeps its lines: every original line still starts at the same place with the same word.
   for (const s of pdfSpans(TEXT_PDF)[0]) {
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd apps/api && uv run pytest -q tests/test_fonts.py tests/test_text.py tests/test_export.py`

Expected: FAIL — no `cjk_style`, no `cjk` manifest section, exports embed whole fonts. Spike output (last lines):

```
==================================== ERRORS ====================================
_____________________ ERROR collecting tests/test_fonts.py _____________________
ImportError while importing test module '<repo>/apps/api/tests/test_fonts.py'.
E   ImportError: cannot import name 'cjk_style' from 'edith.fonts' (<repo>/apps/api/edith/fonts.py)
ERROR tests/test_fonts.py
```

- [ ] **Step 3: Implement**

Modify `.github/workflows/ci.yml`:

```diff
diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml
index 08d729f..c77849f 100644
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ -9,6 +9,11 @@ jobs:
         with: { node-version: 22, cache: npm }
       - uses: astral-sh/setup-uv@v5
       - run: npm ci
+      - uses: actions/cache@v4
+        with:
+          path: packages/fonts/files/cjk
+          key: cjk-fonts-${{ hashFiles('packages/fonts/manifest.json', 'packages/fonts/scripts/fetch-cjk.mjs') }}
+      - run: node packages/fonts/scripts/fetch-cjk.mjs
       - run: cd apps/api && uv sync && uv run pytest -q
       - run: npm run check -w packages/ops
       - run: npm test -w apps/web
```

Modify `.gitignore`:

```diff
--- a/.gitignore
+++ b/.gitignore
@@ -16,3 +16,5 @@
 apps/web/AGENTS.md
 # Owner reference PDFs (not ours to publish)
 references/
+# Optional CJK font pack: node packages/fonts/scripts/fetch-cjk.mjs
+packages/fonts/files/cjk/
```

(`references/` is already ignored by the commit that added this plan.)

Modify `README.md`:

```diff
diff --git a/README.md b/README.md
index 971e26a..30b3d93 100644
--- a/README.md
+++ b/README.md
@@ -8,6 +8,11 @@ Editor PDF berbasis web: unggah PDF, edit teks aslinya (rich text per kata, Cari
 - `apps/web` — Next.js. Merender halaman dengan pdf.js, mengelola edit di browser, dan menata teks sendiri agar sama persis dengan hasil ekspor.
 - `packages/ops` — JSON Schema + tipe TypeScript untuk operasi edit (dihasilkan dari `apps/api/edith/ops.py`).
 - `packages/fonts` — 24 family font bersama (Arimo/Tinos/Cousine/Carlito/Caladea sebagai pengganti metrik font PDF, plus pilihan pengguna; OFL/Apache 2.0, lihat `packages/fonts/LICENSES.md`). Unduh ulang: `node packages/fonts/scripts/fetch.mjs`.
+- Paket font CJK opsional (Noto Sans/Serif KR, JP, SC; regular + bold, ±113 MB) untuk karakter Korea/Jepang/Tionghoa yang tidak ada di font asli PDF. Tidak disimpan di git; unduh sekali per checkout:
+
+      node packages/fonts/scripts/fetch-cjk.mjs   # ke packages/fonts/files/cjk (--force: unduh ulang)
+
+  Tanpa paket ini Edith tetap jalan: karakter CJK yang tidak ada di font asli ditandai "tidak didukung". Docker build mengunduhnya otomatis (`--build-arg CJK_FONTS=0` untuk melewatinya); CI menyimpannya di cache.
 
 ## Menjalankan untuk pengembangan
```

Modify `apps/api/Dockerfile`:

```diff
diff --git a/apps/api/Dockerfile b/apps/api/Dockerfile
index 262ac18..d8005b4 100644
--- a/apps/api/Dockerfile
+++ b/apps/api/Dockerfile
@@ -1,10 +1,18 @@
+# The optional CJK fallback fonts (Korean/Japanese/Chinese, ~113 MB) are downloaded at build time, not committed.
+# Build with --build-arg CJK_FONTS=0 to leave them out (CJK characters then stay "unsupported").
+FROM node:22-slim AS fonts
+ARG CJK_FONTS=1
+WORKDIR /app
+COPY packages/fonts packages/fonts
+RUN if [ "$CJK_FONTS" = "1" ]; then node packages/fonts/scripts/fetch-cjk.mjs; fi
+
 FROM python:3.12-slim
 COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
 WORKDIR /app/apps/api
 COPY apps/api/pyproject.toml apps/api/uv.lock ./
 RUN uv sync --frozen --no-dev
 COPY apps/api/edith ./edith
-COPY packages/fonts /app/packages/fonts
+COPY --from=fonts /app/packages/fonts /app/packages/fonts
 ENV EDITH_DATA_DIR=/data EDITH_FONTS_DIR=/app/packages/fonts
 VOLUME /data
 EXPOSE 8000
```

Modify `apps/api/edith/bake/__init__.py`:

```diff
diff --git a/apps/api/edith/bake/__init__.py b/apps/api/edith/bake/__init__.py
index f7d3e12..90854ba 100644
--- a/apps/api/edith/bake/__init__.py
+++ b/apps/api/edith/bake/__init__.py
@@ -10,6 +10,7 @@ from edith.bake.registry import HANDLERS, PHASE, TEXT_REDACTIONS
 from edith.bake.scrub import scrub_outside, scrub_page, under_redaction
 from edith.bake.source import SourcePages
 from edith.bake.text import links_under_redactions, restore_links
+from edith.bake.tounicode import trim_to_unicode
 from edith.bake.transform import draw_transformed
 from edith.bake.util import to_rect
 from edith.errors import BakeFailed, EdithError, InvalidOp
@@ -101,7 +102,14 @@ def _fill(doc: pymupdf.Document, forms: list, flatten: bool, stale_xfa: bool) ->
             raise BakeFailed(f"cannot flatten the form: {exc}") from exc
 
 
-def bake(source: bytes, ops: list, ctx: BakeContext, flatten_forms: bool = False) -> pymupdf.Document:
+def _font_xrefs(doc: pymupdf.Document) -> set[int]:
+    return {entry[0] for page in doc for entry in page.get_fonts(full=True)}
+
+
+def bake(source: bytes, ops: list, ctx: BakeContext, flatten_forms: bool = False,
+         subset_fonts: bool = False) -> pymupdf.Document:
+    """The edited document. `subset_fonts`: when the bake embedded fonts (TextWriter embeds whole font files:
+    a CJK fallback is 6–15 MB), keep only the glyphs the document uses — MuPDF subsets every embedded font."""
     doc = pymupdf.open(stream=source, filetype="pdf")
     pages_src = None
     try:
@@ -151,6 +159,7 @@ def bake(source: bytes, ops: list, ctx: BakeContext, flatten_forms: bool = False
                 raise InvalidOp(f"link to unknown pageKey {op.target.pageKey}", op_index=i)
 
         key_to_index, base_rotation = build_pages(doc, layout, layout_index, ctx, import_forms)
+        fonts_before = _font_xrefs(doc) if subset_fonts else set()
         ctx = replace(ctx, page_index=key_to_index)
         crops = [_crop_rect(doc[i], entry.crop, layout_index) if entry.crop else None for i, entry in enumerate(layout.pages)]
 
@@ -195,6 +204,11 @@ def bake(source: bytes, ops: list, ctx: BakeContext, flatten_forms: bool = False
             doc[i].set_rotation((base_rotation[i] + entry.rotate) % 360)
         if cropped_widgets:
             drop_xfa(doc)
+        added = _font_xrefs(doc) - fonts_before if subset_fonts else set()
+        if added:
+            doc.subset_fonts()
+            for xref in added:
+                trim_to_unicode(doc, xref)
         return doc
     except BaseException:
         doc.close()
```

Modify `apps/api/edith/bake/tounicode.py`:

```diff
diff --git a/apps/api/edith/bake/tounicode.py b/apps/api/edith/bake/tounicode.py
index d33282b..ff98fa6 100644
--- a/apps/api/edith/bake/tounicode.py
+++ b/apps/api/edith/bake/tounicode.py
@@ -9,7 +9,12 @@ and fonts reused from the uploaded PDF can't be edited at all, so the bake rewri
 font it embeds: same mapping, except a printable ASCII code point wins over the others of its glyph.
 """
 
+import io
+
 import pymupdf
+from fontTools.ttLib import TTFont
+
+from edith.cid_fonts import parse_to_unicode
 
 _MARK = b"%edith-tounicode\n"
 _HEADER = b"""/CIDInit /ProcSet findresource begin
@@ -74,3 +79,27 @@ def fix_to_unicode(doc: pymupdf.Document, font_xref: int) -> None:
     if not buffer:
         return
     doc.update_stream(cmap_xref, to_unicode_cmap(glyph_to_unicode(pymupdf.Font(fontbuffer=buffer))))
+
+
+def trim_to_unicode(doc: pymupdf.Document, font_xref: int) -> None:
+    """After Document.subset_fonts(): drop the entries of glyphs the subset emptied from a CMap fix_to_unicode()
+    wrote (it maps every glyph of the font: ~20 000 for a CJK fallback, ~100 KB compressed). Subsets keep glyph
+    ids, so a dropped glyph is one whose `loca` range is empty. No-op for other CMaps and for CFF fonts."""
+    if doc.xref_get_key(font_xref, "Subtype")[1] != "/Type0":
+        return
+    kind, value = doc.xref_get_key(font_xref, "ToUnicode")
+    if kind != "xref":
+        return
+    cmap_xref = int(value.split()[0])
+    data = doc.xref_stream(cmap_xref)
+    buffer = doc.extract_font(font_xref)[3]
+    if not data.startswith(_MARK) or not buffer:
+        return
+    try:
+        font = TTFont(io.BytesIO(buffer))
+        loca = font["loca"]
+    except Exception:  # noqa: BLE001 - not a TrueType program with glyf/loca
+        return
+    kept = {gid: ord(text) for gid, text in parse_to_unicode(data).items()
+            if gid + 1 < len(loca) and (loca[gid] != loca[gid + 1] or text.isspace())}
+    doc.update_stream(cmap_xref, to_unicode_cmap(kept))
```

Modify `apps/api/edith/fonts.py`:

```diff
diff --git a/apps/api/edith/fonts.py b/apps/api/edith/fonts.py
index d7206ec..e73b624 100644
--- a/apps/api/edith/fonts.py
+++ b/apps/api/edith/fonts.py
@@ -24,6 +24,20 @@ _BOLD_WORDS = ("bold", "black", "heavy", "semibold", "demibold", "demi")
 _ITALIC_WORDS = ("italic", "oblique")
 FLAG_ITALIC, FLAG_SERIF, FLAG_MONO, FLAG_BOLD = 2, 4, 8, 16  # pymupdf TEXT_FONT_* span flags
 
+# CJK font names (normalized: lowercase alphanumerics) → script of the optional fallback pack (manifest "cjk").
+_CJK_NAMES = {
+    "kr": ("dotum", "gulim", "batang", "gungsuh", "malgun", "nanum", "haansoft", "hancom", "hymyeongjo", "hygothic",
+           "hygungso", "hyheadline", "applegothic", "applemyungjo", "undotum", "unbatang", "baekmuk"),
+    "jp": ("msgothic", "mspgothic", "msuigothic", "msmincho", "mspmincho", "mincho", "meiryo", "yugothic", "hiragino",
+           "kozuka", "kozmin", "kozgo", "ipagothic", "ipaexgothic", "takao"),
+    "sc": ("simsun", "simhei", "simkai", "kaiti", "fangsong", "songti", "heiti", "yahei", "pingfang", "stsong",
+           "stheiti", "stkaiti", "dengxian", "mingliu", "jhenghei"),
+}
+_NOTO_CJK = re.compile(r"noto(sans|serif)(cjk)?(kr|jp|sc|tc)")
+# Words of serif (Myeongjo / Mincho / Song) CJK designs; any other CJK font is matched with a gothic (sans) one.
+_CJK_SERIF = ("batang", "gungsuh", "myeongjo", "myungjo", "mincho", "kozmin", "song", "simsun", "ming", "kai",
+              "fangsong", "serif")
+
 
 def style_key(bold: bool, italic: bool) -> str:
     if bold and italic:
@@ -52,6 +66,18 @@ def parse_font_name(name: str) -> tuple[str, bool, bool]:
     return key, bold, italic
 
 
+def cjk_style(name: str) -> tuple[str, str] | None:
+    """(script, category) of the fallback for a CJK font name — script "kr" | "jp" | "sc" (Traditional Chinese
+    fonts use "sc"), category "sans" | "serif" — or None when the name is not a known CJK font."""
+    key = re.sub(r"[^a-z0-9]", "", base_font_name(name).lower())
+    noto = _NOTO_CJK.search(key)
+    script = ({"tc": "sc"}.get(noto.group(3), noto.group(3)) if noto else
+              next((s for s, words in _CJK_NAMES.items() if any(w in key for w in words)), None))
+    if script is None:
+        return None
+    return script, "serif" if any(w in key for w in _CJK_SERIF) else "sans"
+
+
 class FontRegistry:
     def __init__(self, fonts_dir: Path):
         self._dir = Path(fonts_dir)
@@ -61,20 +87,34 @@ class FontRegistry:
         for family, info in self._manifest["families"].items():
             for alias in info.get("aliases", []):
                 self._aliases[alias] = family
+        # The optional CJK pack (scripts/fetch-cjk.mjs): only families whose regular file is there.
+        self._cjk: dict[str, dict] = {}
+        for family, info in self._manifest.get("cjk", {}).items():
+            files = {s: f for s, f in info["files"].items() if (self._dir / "files" / f).is_file()}
+            if "regular" in files:
+                self._cjk[family] = {**info, "files": files}
+
+    def cjk(self, script: str, category: str) -> str | None:
+        """The pack family for `script` ("kr" | "jp" | "sc") in `category` ("serif" or anything else → sans),
+        else the other category of that script, else None (pack not fetched)."""
+        wanted = "serif" if category == "serif" else "sans"
+        found = {info["category"]: family for family, info in self._cjk.items() if info["script"] == script}
+        return found.get(wanted) or next(iter(found.values()), None)
 
     def families(self) -> list[str]:
         return list(self._manifest["families"].keys())
 
-    def category(self, family: str) -> str:
-        fam = self._manifest["families"].get(family)
+    def _family(self, family: str) -> dict:
+        fam = self._manifest["families"].get(family) or self._cjk.get(family)
         if fam is None:
             raise UnknownFont(family)
-        return fam["category"]
+        return fam
+
+    def category(self, family: str) -> str:
+        return self._family(family)["category"]
 
     def path(self, family: str, bold: bool, italic: bool) -> Path:
-        fam = self._manifest["families"].get(family)
-        if fam is None:
-            raise UnknownFont(family)
+        fam = self._family(family)
         for style in _STYLE_FALLBACK[style_key(bold, italic)]:
             if style in fam["files"]:
                 return self._dir / "files" / fam["files"][style]
@@ -101,11 +141,15 @@ class FontRegistry:
         return None
 
     def substitute(self, name: str, flags: int = 0) -> dict:
-        """The bundled FontRef (as JSON) used in place of the PDF font `name`: alias match first,
-        else by span flags (serif → Tinos, mono → Cousine, otherwise Arimo). Bold/italic come
-        from the name and the flags."""
+        """The bundled FontRef (as JSON) used in place of the PDF font `name`: alias match first, then a
+        CJK font name → the pack family of its script and design (Dotum → Noto Sans KR, Batang → Noto Serif
+        KR) when the pack is there, else by span flags (serif → Tinos, mono → Cousine, otherwise Arimo).
+        Bold/italic come from the name and the flags."""
         _, name_bold, name_italic = parse_font_name(name)
         family = self.match(name)
+        hint = cjk_style(name) if family is None else None
+        if hint is not None:
+            family = self.cjk(*hint)
         if family is None:
             fallback = self._manifest["fallback"]
             if flags & FLAG_MONO:
```

Modify `apps/api/edith/routes/export.py`:

```diff
diff --git a/apps/api/edith/routes/export.py b/apps/api/edith/routes/export.py
index d466528..9d5c4bd 100644
--- a/apps/api/edith/routes/export.py
+++ b/apps/api/edith/routes/export.py
@@ -69,7 +69,7 @@ def _page_index(ops: list, page_key: str, page_count: int) -> int:
 @router.post("/documents/{doc_id}/export")
 def export(request: Request, doc_id: str, body: ExportRequest) -> Response:
     source = _read_source(request, doc_id)
-    doc = bake(source, body.ops, _ctx(request, doc_id), flatten_forms=body.flatten_forms)
+    doc = bake(source, body.ops, _ctx(request, doc_id), flatten_forms=body.flatten_forms, subset_fonts=True)
     try:
         data = doc.tobytes(garbage=3, deflate=True)
     finally:
```

Modify `apps/web/Dockerfile`:

```diff
diff --git a/apps/web/Dockerfile b/apps/web/Dockerfile
index b9d8949..d04887d 100644
--- a/apps/web/Dockerfile
+++ b/apps/web/Dockerfile
@@ -6,6 +6,9 @@ COPY packages/ops/package.json packages/ops/
 COPY packages/fonts/package.json packages/fonts/
 RUN npm ci
 COPY . .
+# Optional CJK fallback fonts (see apps/api/Dockerfile); sync-fonts copies them to public/fonts.
+ARG CJK_FONTS=1
+RUN if [ "$CJK_FONTS" = "1" ]; then node packages/fonts/scripts/fetch-cjk.mjs; fi
 ARG NEXT_PUBLIC_API_URL=http://localhost:8000
 ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
 RUN npm run build -w apps/web
```

Modify `packages/fonts/LICENSES.md`:

```diff
diff --git a/packages/fonts/LICENSES.md b/packages/fonts/LICENSES.md
index 04b4a07..2dc29a8 100644
--- a/packages/fonts/LICENSES.md
+++ b/packages/fonts/LICENSES.md
@@ -9,4 +9,6 @@ All files in `files/` are static TTFs downloaded from Google Fonts by `scripts/f
 | Carlito (metric-compatible with Calibri) | SIL Open Font License 1.1 |
 | Inter, Roboto, Open Sans, Lato, Montserrat, Poppins, Source Sans 3, Lora, Playfair Display, Source Serif 4, PT Serif, JetBrains Mono, Noto Sans, Noto Serif, Merriweather, Dancing Script, Caveat, Great Vibes, Sacramento | SIL Open Font License 1.1 |
 
+The optional CJK pack in `files/cjk/` (Noto Sans KR/JP/SC, Noto Serif KR/JP/SC) is downloaded by `scripts/fetch-cjk.mjs` from Google Fonts and is not committed; SIL Open Font License 1.1.
+
 Apache License 2.0: https://www.apache.org/licenses/LICENSE-2.0 — SIL OFL 1.1: https://openfontlicense.org
```

Modify `packages/fonts/manifest.json`:

```diff
diff --git a/packages/fonts/manifest.json b/packages/fonts/manifest.json
index 74df827..9c92e7e 100644
--- a/packages/fonts/manifest.json
+++ b/packages/fonts/manifest.json
@@ -122,5 +122,13 @@
       "files": {"regular": "Sacramento-Regular.ttf"},
       "aliases": ["sacramento"]
     }
+  },
+  "cjk": {
+    "Noto Sans KR": {"category": "sans", "script": "kr", "files": {"regular": "cjk/NotoSansKR-Regular.ttf", "bold": "cjk/NotoSansKR-Bold.ttf"}},
+    "Noto Serif KR": {"category": "serif", "script": "kr", "files": {"regular": "cjk/NotoSerifKR-Regular.ttf", "bold": "cjk/NotoSerifKR-Bold.ttf"}},
+    "Noto Sans JP": {"category": "sans", "script": "jp", "files": {"regular": "cjk/NotoSansJP-Regular.ttf", "bold": "cjk/NotoSansJP-Bold.ttf"}},
+    "Noto Serif JP": {"category": "serif", "script": "jp", "files": {"regular": "cjk/NotoSerifJP-Regular.ttf", "bold": "cjk/NotoSerifJP-Bold.ttf"}},
+    "Noto Sans SC": {"category": "sans", "script": "sc", "files": {"regular": "cjk/NotoSansSC-Regular.ttf", "bold": "cjk/NotoSansSC-Bold.ttf"}},
+    "Noto Serif SC": {"category": "serif", "script": "sc", "files": {"regular": "cjk/NotoSerifSC-Regular.ttf", "bold": "cjk/NotoSerifSC-Bold.ttf"}}
   }
 }
```

Create `packages/fonts/scripts/fetch-cjk.mjs`:

```js
// Downloads the optional CJK fallback pack (manifest.json "cjk": Noto Sans/Serif KR, JP, SC; regular + bold, about
// 63 MB) from the Google Fonts CSS API into ../files/cjk. Not committed (see .gitignore): run it once per checkout,
// in the Docker builds and in CI. Without the pack, Korean/Japanese/Chinese characters stay "unsupported".
// Files already present are kept (each is written to .part first, then renamed), so a cached ../files/cjk makes it
// a no-op; `--force` downloads everything again.
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const filesDir = path.join(here, "..", "files");
const manifest = JSON.parse(await readFile(path.join(here, "..", "manifest.json"), "utf8"));
const WEIGHT = { 400: "regular", 700: "bold" };

const force = process.argv.includes("--force");

async function get(url, as) {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/4.0" } }); // old UA: one full TTF per style
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return as === "text" ? res.text() : Buffer.from(await res.arrayBuffer());
}

const exists = (file) => access(file).then(() => true, () => false);

await mkdir(path.join(filesDir, "cjk"), { recursive: true });
for (const [family, info] of Object.entries(manifest.cjk)) {
  const css = await get(`https://fonts.googleapis.com/css2?family=${family.replace(/ /g, "+")}:wght@400;700`, "text");
  const served = {};
  for (const block of css.split("@font-face").slice(1)) {
    served[WEIGHT[/font-weight:\s*(\d+)/.exec(block)[1]]] = /url\((https:[^)]+\.ttf)\)/.exec(block)[1];
  }
  for (const [style, file] of Object.entries(info.files)) {
    if (!served[style]) throw new Error(`${family} ${style}: not served by Google Fonts`);
    const target = path.join(filesDir, file);
    if (!force && (await exists(target))) { console.log("kept", file); continue; }
    const buf = await get(served[style]);
    await writeFile(`${target}.part`, buf);
    await rename(`${target}.part`, target); // never leave a truncated font behind
    console.log("saved", file, buf.length);
  }
}
```

Then fetch the pack once: `node packages/fonts/scripts/fetch-cjk.mjs` (≈20 s, ±113 MB into `packages/fonts/files/cjk/`, ignored by git; a second run prints `kept …`). The API tests do not need it (they use `fake_cjk_pack`); the web (Task 15) and the E2E (Task 16) use it.

- [ ] **Step 4: Run the suites**

Run: `cd apps/api && uv run pytest -q` → 419 passed. Web unchanged (293). E2E (servers on your own ports, see README Global Constraints): `E2E_WEB_PORT=… E2E_API_PORT=… npm run e2e -w apps/web -- text.spec.ts` → 2 passed.

- [ ] **Step 5: Commit**

```bash
git checkout apps/web/tsconfig.json 2>/dev/null; rm -f apps/web/AGENTS.md
git add .github/workflows/ci.yml .gitignore README.md apps/api/Dockerfile apps/api/edith/bake/__init__.py apps/api/edith/bake/tounicode.py apps/api/edith/fonts.py apps/api/edith/routes/export.py apps/api/tests/pdfs.py apps/api/tests/test_export.py apps/api/tests/test_fonts.py apps/api/tests/test_text.py apps/web/Dockerfile apps/web/e2e/text.spec.ts packages/fonts/LICENSES.md packages/fonts/manifest.json packages/fonts/scripts/fetch-cjk.mjs
git commit -m "feat(fonts): optional CJK fallback pack (Noto KR/JP/SC), CJK substitutes, font subsetting at export" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
