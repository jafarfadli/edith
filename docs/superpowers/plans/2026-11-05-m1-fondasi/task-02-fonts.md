# Task 2: Shared font package

**Files:**
- Create: `packages/fonts/package.json`, `packages/fonts/manifest.json`, `packages/fonts/scripts/fetch.mjs`, `packages/fonts/files/*.ttf` (12 files, committed), `packages/fonts/LICENSES.md`
- Create: `apps/api/edith/fonts.py`, `apps/api/tests/test_fonts.py`
- Create: `apps/web/scripts/sync-fonts.mjs`; Modify: `apps/web/package.json` (scripts)

**Interfaces:**
- Consumes: `Settings.fonts_dir` (Task 1).
- Produces:
  - `packages/fonts/manifest.json` with shape `{ "default": "Arimo", "families": { [family]: { "category": "sans"|"serif"|"mono", "files": { "regular","bold","italic","bolditalic": filename }, "aliases": string[] } } }`
  - Python `edith.fonts.FontRegistry(fonts_dir: Path)`: `.families() -> list[str]`, `.path(family: str, bold: bool, italic: bool) -> Path`, `.font(family, bold, italic) -> pymupdf.Font` (cached), raises `UnknownFont(KeyError)` for unknown family.
  - Web serves fonts at `/fonts/manifest.json` and `/fonts/<file>.ttf` (copied by `sync-fonts`).

- [ ] **Step 1: Package + fetch script**

`packages/fonts/package.json`:
```json
{
  "name": "@edith/fonts",
  "version": "0.1.0",
  "private": true,
  "scripts": { "fetch": "node scripts/fetch.mjs" }
}
```

`packages/fonts/scripts/fetch.mjs`:
```js
// Downloads static TTF files from the Google Fonts CSS API.
// An old user agent makes the API return truetype URLs instead of woff2.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "..", "files");
const FAMILIES = ["Arimo", "Tinos", "Cousine"];
const STYLE = { "normal-400": "Regular", "normal-700": "Bold", "italic-400": "Italic", "italic-700": "BoldItalic" };

await mkdir(outDir, { recursive: true });
for (const family of FAMILIES) {
  const url = `https://fonts.googleapis.com/css2?family=${family}:ital,wght@0,400;0,700;1,400;1,700`;
  const css = await (await fetch(url, { headers: { "User-Agent": "Mozilla/4.0" } })).text();
  const blocks = css.split("@font-face").slice(1);
  for (const b of blocks) {
    const style = /font-style:\s*(\w+)/.exec(b)[1];
    const weight = /font-weight:\s*(\d+)/.exec(b)[1];
    const src = /url\((https:[^)]+\.ttf)\)/.exec(b)[1];
    const name = `${family}-${STYLE[`${style}-${weight}`]}.ttf`;
    const buf = Buffer.from(await (await fetch(src)).arrayBuffer());
    await writeFile(path.join(outDir, name), buf);
    console.log("saved", name, buf.length);
  }
}
```

Run: `npm run fetch -w packages/fonts`
Expected: 12 lines `saved <Family>-<Style>.ttf <bytes>`; `ls packages/fonts/files | wc -l` → `12`.

`packages/fonts/manifest.json`:
```json
{
  "default": "Arimo",
  "families": {
    "Arimo": {
      "category": "sans",
      "files": { "regular": "Arimo-Regular.ttf", "bold": "Arimo-Bold.ttf", "italic": "Arimo-Italic.ttf", "bolditalic": "Arimo-BoldItalic.ttf" },
      "aliases": ["arimo", "helvetica", "helv", "arial", "arialmt", "liberationsans"]
    },
    "Tinos": {
      "category": "serif",
      "files": { "regular": "Tinos-Regular.ttf", "bold": "Tinos-Bold.ttf", "italic": "Tinos-Italic.ttf", "bolditalic": "Tinos-BoldItalic.ttf" },
      "aliases": ["tinos", "times", "timesroman", "timesnewroman", "timesnewromanpsmt", "tiro", "liberationserif"]
    },
    "Cousine": {
      "category": "mono",
      "files": { "regular": "Cousine-Regular.ttf", "bold": "Cousine-Bold.ttf", "italic": "Cousine-Italic.ttf", "bolditalic": "Cousine-BoldItalic.ttf" },
      "aliases": ["cousine", "courier", "couriernew", "cour", "liberationmono"]
    }
  }
}
```

`packages/fonts/LICENSES.md`:
```md
Arimo, Tinos and Cousine are licensed under the Apache License 2.0 (Google / Ascender). Downloaded from Google Fonts by scripts/fetch.mjs.
```

- [ ] **Step 2: Failing API test**

`apps/api/tests/test_fonts.py`:
```python
import pymupdf
import pytest

from edith.fonts import FontRegistry, UnknownFont
from edith.settings import Settings


@pytest.fixture
def registry() -> FontRegistry:
    return FontRegistry(Settings().fonts_dir)


def test_families(registry):
    assert registry.families() == ["Arimo", "Tinos", "Cousine"]


def test_path_variants(registry):
    assert registry.path("Arimo", False, False).name == "Arimo-Regular.ttf"
    assert registry.path("Tinos", True, True).name == "Tinos-BoldItalic.ttf"
    assert registry.path("Cousine", False, True).exists()


def test_font_is_cached_pymupdf_font(registry):
    f = registry.font("Arimo", True, False)
    assert isinstance(f, pymupdf.Font)
    assert f is registry.font("Arimo", True, False)
    assert f.text_length("AV", fontsize=10) > 0


def test_unknown_family(registry):
    with pytest.raises(UnknownFont):
        registry.path("Comic", False, False)
```

Run: `cd apps/api && uv run pytest tests/test_fonts.py -q` → Expected: FAIL (`ModuleNotFoundError: edith.fonts`).

- [ ] **Step 3: Implement registry**

`apps/api/edith/fonts.py`:
```python
import json
from pathlib import Path

import pymupdf


class UnknownFont(KeyError):
    pass


def _style_key(bold: bool, italic: bool) -> str:
    if bold and italic:
        return "bolditalic"
    if bold:
        return "bold"
    if italic:
        return "italic"
    return "regular"


class FontRegistry:
    def __init__(self, fonts_dir: Path):
        self._dir = Path(fonts_dir)
        self._manifest = json.loads((self._dir / "manifest.json").read_text())
        self._cache: dict[tuple[str, bool, bool], pymupdf.Font] = {}

    def families(self) -> list[str]:
        return list(self._manifest["families"].keys())

    def path(self, family: str, bold: bool, italic: bool) -> Path:
        fam = self._manifest["families"].get(family)
        if fam is None:
            raise UnknownFont(family)
        return self._dir / "files" / fam["files"][_style_key(bold, italic)]

    def font(self, family: str, bold: bool, italic: bool) -> pymupdf.Font:
        key = (family, bold, italic)
        if key not in self._cache:
            self._cache[key] = pymupdf.Font(fontfile=str(self.path(family, bold, italic)))
        return self._cache[key]
```

Run: `cd apps/api && uv run pytest tests/test_fonts.py -q` → Expected: `4 passed`.

- [ ] **Step 4: Web font sync**

`apps/web/scripts/sync-fonts.mjs`:
```js
import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, "../../../packages/fonts");
const dest = path.resolve(here, "../public/fonts");
await mkdir(dest, { recursive: true });
await cp(path.join(src, "manifest.json"), path.join(dest, "manifest.json"));
await cp(path.join(src, "files"), dest, { recursive: true });
console.log("fonts synced to", dest);
```

In `apps/web/package.json` scripts add:
```json
"sync-fonts": "node scripts/sync-fonts.mjs",
"predev": "npm run sync-fonts",
"prebuild": "npm run sync-fonts",
"pretest": "npm run sync-fonts"
```

Run: `npm run sync-fonts -w apps/web && ls apps/web/public/fonts | wc -l`
Expected: `13` (12 TTF + manifest).

- [ ] **Step 5: Commit**

```bash
git add packages/fonts apps/api/edith/fonts.py apps/api/tests/test_fonts.py apps/web/scripts apps/web/package.json package-lock.json
git commit -m "feat: add shared font package and API font registry

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
