# Task 1: Font registry (21 families, style fallback, substitutes)

**Files:**
- Modify: `packages/fonts/scripts/fetch.mjs` (rewrite), `packages/fonts/manifest.json` (rewrite), `packages/fonts/LICENSES.md` (rewrite)
- Create: `packages/fonts/files/*.ttf` (downloaded by the script, committed)
- Modify: `apps/api/edith/fonts.py` (rewrite), `apps/api/tests/test_fonts.py` (rewrite)
- Modify: `apps/web/src/lib/fonts.ts` (style fallback), `apps/web/src/lib/fonts.test.ts`, `apps/web/scripts/sync-fonts.mjs` (purge stale files)

**Interfaces:**
- Consumes: M1 `FontRegistry` (`families()`, `path()`, `font()`), M1 web `FontStore`.
- Produces:
  - `packages/fonts/manifest.json`: `{ default, fallback: {sans, serif, mono}, families: { [family]: { category: "sans"|"serif"|"mono"|"script", files: Partial<Record<"regular"|"bold"|"italic"|"bolditalic", string>>, aliases: string[] } } }`.
  - `apps/api/edith/fonts.py`:
    ```python
    STYLES: tuple[str, ...]  # ("regular", "bold", "italic", "bolditalic")
    FLAG_ITALIC, FLAG_SERIF, FLAG_MONO, FLAG_BOLD = 2, 4, 8, 16
    def style_key(bold: bool, italic: bool) -> str
    def base_font_name(name: str) -> str                     # drops "ABCDEF+"
    def parse_font_name(name: str) -> tuple[str, bool, bool]  # (family key, bold, italic)
    class FontRegistry:
        def families(self) -> list[str]
        def category(self, family: str) -> str
        def path(self, family: str, bold: bool, italic: bool) -> Path   # with style fallback
        def font(self, family: str, bold: bool, italic: bool) -> pymupdf.Font
        def match(self, name: str) -> str | None                  # alias match
        def substitute(self, name: str, flags: int = 0) -> dict   # {"kind":"bundled","family","bold","italic"}
    ```
  - `apps/web/src/lib/fonts.ts`: `export type Style = "regular" | "bold" | "italic" | "bolditalic"; export function pickFile(files: Partial<Record<Style, string>>, wanted: Style): string` (same fallback order as the API).

- [ ] **Step 1: Rewrite the fetch script**

`packages/fonts/scripts/fetch.mjs`:
```js
// Downloads static TTF files from the Google Fonts CSS API into ../files and checks them against manifest.json.
// An old user agent makes the API return one full truetype file per style instead of woff2 subsets.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "..", "files");
const manifest = JSON.parse(await readFile(path.join(here, "..", "manifest.json"), "utf8"));
const STYLE = { "normal-400": "regular", "normal-700": "bold", "italic-400": "italic", "italic-700": "bolditalic" };

async function get(url, as) {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/4.0" } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return as === "text" ? res.text() : Buffer.from(await res.arrayBuffer());
}

await mkdir(outDir, { recursive: true });
for (const [family, info] of Object.entries(manifest.families)) {
  const css = await get(`https://fonts.googleapis.com/css2?family=${family.replace(/ /g, "+")}:ital,wght@0,400;0,700;1,400;1,700`, "text");
  const served = {};
  for (const block of css.split("@font-face").slice(1)) {
    const style = STYLE[`${/font-style:\s*(\w+)/.exec(block)[1]}-${/font-weight:\s*(\d+)/.exec(block)[1]}`];
    served[style] = /url\((https:[^)]+\.ttf)\)/.exec(block)[1];
  }
  for (const [style, file] of Object.entries(info.files)) {
    if (!served[style]) throw new Error(`${family} ${style}: not served by Google Fonts`);
    const buf = await get(served[style]);
    await writeFile(path.join(outDir, file), buf);
    console.log("saved", file, buf.length);
  }
  const extra = Object.keys(served).filter((s) => !info.files[s]);
  if (extra.length) throw new Error(`${family}: manifest lacks served styles ${extra.join(", ")}`);
}
```

- [ ] **Step 2: Rewrite the manifest**

`packages/fonts/manifest.json` (the script reads it; file names drop spaces from the family):
```json
{
  "default": "Arimo",
  "fallback": { "sans": "Arimo", "serif": "Tinos", "mono": "Cousine" },
  "families": {
    "Arimo": {
      "category": "sans",
      "files": { "regular": "Arimo-Regular.ttf", "bold": "Arimo-Bold.ttf", "italic": "Arimo-Italic.ttf", "bolditalic": "Arimo-BoldItalic.ttf" },
      "aliases": ["arimo", "helvetica", "helv", "arial", "arialmt", "liberationsans", "nimbussans", "nimbussansl", "helveticaneue"]
    },
    "Tinos": {
      "category": "serif",
      "files": { "regular": "Tinos-Regular.ttf", "bold": "Tinos-Bold.ttf", "italic": "Tinos-Italic.ttf", "bolditalic": "Tinos-BoldItalic.ttf" },
      "aliases": ["tinos", "times", "timesroman", "timesnewroman", "timesnewromanps", "timesnewromanpsmt", "tiro", "liberationserif", "nimbusroman", "nimbusromanno9l"]
    },
    "Cousine": {
      "category": "mono",
      "files": { "regular": "Cousine-Regular.ttf", "bold": "Cousine-Bold.ttf", "italic": "Cousine-Italic.ttf", "bolditalic": "Cousine-BoldItalic.ttf" },
      "aliases": ["cousine", "courier", "couriernew", "couriernewps", "couriernewpsmt", "cour", "liberationmono", "nimbusmono", "nimbusmonops"]
    },
    "Carlito": {
      "category": "sans",
      "files": { "regular": "Carlito-Regular.ttf", "bold": "Carlito-Bold.ttf", "italic": "Carlito-Italic.ttf", "bolditalic": "Carlito-BoldItalic.ttf" },
      "aliases": ["carlito", "calibri"]
    },
    "Caladea": {
      "category": "serif",
      "files": { "regular": "Caladea-Regular.ttf", "bold": "Caladea-Bold.ttf", "italic": "Caladea-Italic.ttf", "bolditalic": "Caladea-BoldItalic.ttf" },
      "aliases": ["caladea", "cambria"]
    },
    "Inter": {
      "category": "sans",
      "files": { "regular": "Inter-Regular.ttf", "bold": "Inter-Bold.ttf", "italic": "Inter-Italic.ttf", "bolditalic": "Inter-BoldItalic.ttf" },
      "aliases": ["inter"]
    },
    "Roboto": {
      "category": "sans",
      "files": { "regular": "Roboto-Regular.ttf", "bold": "Roboto-Bold.ttf", "italic": "Roboto-Italic.ttf", "bolditalic": "Roboto-BoldItalic.ttf" },
      "aliases": ["roboto"]
    },
    "Open Sans": {
      "category": "sans",
      "files": { "regular": "OpenSans-Regular.ttf", "bold": "OpenSans-Bold.ttf", "italic": "OpenSans-Italic.ttf", "bolditalic": "OpenSans-BoldItalic.ttf" },
      "aliases": ["opensans"]
    },
    "Lato": {
      "category": "sans",
      "files": { "regular": "Lato-Regular.ttf", "bold": "Lato-Bold.ttf", "italic": "Lato-Italic.ttf", "bolditalic": "Lato-BoldItalic.ttf" },
      "aliases": ["lato"]
    },
    "Montserrat": {
      "category": "sans",
      "files": { "regular": "Montserrat-Regular.ttf", "bold": "Montserrat-Bold.ttf", "italic": "Montserrat-Italic.ttf", "bolditalic": "Montserrat-BoldItalic.ttf" },
      "aliases": ["montserrat"]
    },
    "Poppins": {
      "category": "sans",
      "files": { "regular": "Poppins-Regular.ttf", "bold": "Poppins-Bold.ttf", "italic": "Poppins-Italic.ttf", "bolditalic": "Poppins-BoldItalic.ttf" },
      "aliases": ["poppins"]
    },
    "Source Sans 3": {
      "category": "sans",
      "files": { "regular": "SourceSans3-Regular.ttf", "bold": "SourceSans3-Bold.ttf", "italic": "SourceSans3-Italic.ttf", "bolditalic": "SourceSans3-BoldItalic.ttf" },
      "aliases": ["sourcesans3", "sourcesanspro"]
    },
    "Lora": {
      "category": "serif",
      "files": { "regular": "Lora-Regular.ttf", "bold": "Lora-Bold.ttf", "italic": "Lora-Italic.ttf", "bolditalic": "Lora-BoldItalic.ttf" },
      "aliases": ["lora"]
    },
    "Playfair Display": {
      "category": "serif",
      "files": { "regular": "PlayfairDisplay-Regular.ttf", "bold": "PlayfairDisplay-Bold.ttf", "italic": "PlayfairDisplay-Italic.ttf", "bolditalic": "PlayfairDisplay-BoldItalic.ttf" },
      "aliases": ["playfairdisplay"]
    },
    "Source Serif 4": {
      "category": "serif",
      "files": { "regular": "SourceSerif4-Regular.ttf", "bold": "SourceSerif4-Bold.ttf", "italic": "SourceSerif4-Italic.ttf", "bolditalic": "SourceSerif4-BoldItalic.ttf" },
      "aliases": ["sourceserif4", "sourceserifpro"]
    },
    "PT Serif": {
      "category": "serif",
      "files": { "regular": "PTSerif-Regular.ttf", "bold": "PTSerif-Bold.ttf", "italic": "PTSerif-Italic.ttf", "bolditalic": "PTSerif-BoldItalic.ttf" },
      "aliases": ["ptserif"]
    },
    "JetBrains Mono": {
      "category": "mono",
      "files": { "regular": "JetBrainsMono-Regular.ttf", "bold": "JetBrainsMono-Bold.ttf", "italic": "JetBrainsMono-Italic.ttf", "bolditalic": "JetBrainsMono-BoldItalic.ttf" },
      "aliases": ["jetbrainsmono"]
    },
    "Dancing Script": {
      "category": "script",
      "files": { "regular": "DancingScript-Regular.ttf", "bold": "DancingScript-Bold.ttf" },
      "aliases": ["dancingscript"]
    },
    "Caveat": {
      "category": "script",
      "files": { "regular": "Caveat-Regular.ttf", "bold": "Caveat-Bold.ttf" },
      "aliases": ["caveat"]
    },
    "Great Vibes": {
      "category": "script",
      "files": { "regular": "GreatVibes-Regular.ttf" },
      "aliases": ["greatvibes"]
    },
    "Sacramento": {
      "category": "script",
      "files": { "regular": "Sacramento-Regular.ttf" },
      "aliases": ["sacramento"]
    }
  }
}
```

- [ ] **Step 3: Download the fonts**

Run: `node packages/fonts/scripts/fetch.mjs`
Expected: 74 `saved …` lines (the 12 M1 files are re-downloaded unchanged), no error; `ls packages/fonts/files | wc -l` → `74`; `du -sh packages/fonts/files` → about `16M`.

- [ ] **Step 4: Licenses**

`packages/fonts/LICENSES.md`:
```markdown
# Font licenses

All files in `files/` are static TTFs downloaded from Google Fonts by `scripts/fetch.mjs` (full character set).

| Families | License |
|---|---|
| Arimo, Tinos, Cousine (metric-compatible with Arial, Times New Roman, Courier New) | Apache License 2.0 |
| Caladea (metric-compatible with Cambria) | Apache License 2.0 |
| Carlito (metric-compatible with Calibri) | SIL Open Font License 1.1 |
| Inter, Roboto, Open Sans, Lato, Montserrat, Poppins, Source Sans 3, Lora, Playfair Display, Source Serif 4, PT Serif, JetBrains Mono, Dancing Script, Caveat, Great Vibes, Sacramento | SIL Open Font License 1.1 |

Apache License 2.0: https://www.apache.org/licenses/LICENSE-2.0 — SIL OFL 1.1: https://openfontlicense.org
```

- [ ] **Step 5: Failing API tests**

`apps/api/tests/test_fonts.py` (replace the file):
```python
import json

import pymupdf
import pytest

from edith.fonts import STYLES, FontRegistry, UnknownFont, base_font_name, parse_font_name
from edith.settings import Settings


@pytest.fixture
def registry() -> FontRegistry:
    return FontRegistry(Settings().fonts_dir)


def test_families(registry):
    families = registry.families()
    assert families[:5] == ["Arimo", "Tinos", "Cousine", "Carlito", "Caladea"]
    assert len(families) == 21
    assert {registry.category(f) for f in families} == {"sans", "serif", "mono", "script"}


def test_every_manifest_file_exists_and_loads():
    fonts_dir = Settings().fonts_dir
    manifest = json.loads((fonts_dir / "manifest.json").read_text())
    for family, info in manifest["families"].items():
        assert "regular" in info["files"], family
        assert set(info["files"]) <= set(STYLES), family
        for file in info["files"].values():
            font = pymupdf.Font(fontfile=str(fonts_dir / "files" / file))
            assert font.has_glyph(ord("a")), file


def test_path_variants(registry):
    assert registry.path("Arimo", False, False).name == "Arimo-Regular.ttf"
    assert registry.path("Tinos", True, True).name == "Tinos-BoldItalic.ttf"
    assert registry.path("Open Sans", False, True).name == "OpenSans-Italic.ttf"


def test_missing_styles_fall_back(registry):
    assert registry.path("Dancing Script", True, True).name == "DancingScript-Bold.ttf"
    assert registry.path("Dancing Script", False, True).name == "DancingScript-Regular.ttf"
    assert registry.path("Great Vibes", True, False).name == "GreatVibes-Regular.ttf"


def test_font_is_cached_pymupdf_font(registry):
    f = registry.font("Arimo", True, False)
    assert isinstance(f, pymupdf.Font)
    assert f is registry.font("Arimo", True, False)
    assert f.text_length("AV", fontsize=10) > 0


def test_unknown_family(registry):
    with pytest.raises(UnknownFont):
        registry.path("Comic", False, False)


def test_name_parsing():
    assert base_font_name("ABCDEF+Calibri-Bold") == "Calibri-Bold"
    assert parse_font_name("ABCDEF+Arial,BoldItalic") == ("arial", True, True)
    assert parse_font_name("Times New Roman") == ("timesnewroman", False, False)
    assert parse_font_name("Helvetica-Oblique") == ("helvetica", False, True)


@pytest.mark.parametrize("name,flags,family,bold,italic", [
    ("Helvetica", 0, "Arimo", False, False),
    ("ABCDEF+Arial-BoldMT", 0, "Arimo", True, False),
    ("TimesNewRomanPS-BoldItalicMT", 0, "Tinos", True, True),
    ("Times-Roman", 0, "Tinos", False, False),
    ("Courier-Oblique", 0, "Cousine", False, True),
    ("NimbusMonoPS-Regular", 0, "Cousine", False, False),
    ("Arimo Regular", 4, "Arimo", False, False),       # alias beats the serif flag
    ("Calibri,Bold", 0, "Carlito", True, False),
    ("Cambria-Italic", 0, "Caladea", False, True),
    ("SourceSansPro-Regular", 0, "Source Sans 3", False, False),
    ("GreatVibes-Regular", 0, "Great Vibes", False, False),
    ("Garamond", 4, "Tinos", False, False),            # unknown: serif flag
    ("Consolas", 8, "Cousine", False, False),          # unknown: mono flag
    ("Verdana", 16 | 2, "Arimo", True, True),          # unknown: sans, bold/italic from flags
])
def test_substitute(registry, name, flags, family, bold, italic):
    assert registry.substitute(name, flags) == {"kind": "bundled", "family": family, "bold": bold, "italic": italic}
```

Run: `cd apps/api && uv run pytest tests/test_fonts.py -q`
Expected: FAIL — `ImportError: cannot import name 'STYLES' from 'edith.fonts'`.

- [ ] **Step 6: Implement the registry**

`apps/api/edith/fonts.py` (replace the file):
```python
import json
import re
from pathlib import Path

import pymupdf


class UnknownFont(KeyError):
    pass


STYLES = ("regular", "bold", "italic", "bolditalic")
# Styles to try, in order, when a family lacks the requested one (the web FontStore uses the same order).
_STYLE_FALLBACK = {
    "regular": ("regular",),
    "bold": ("bold", "regular"),
    "italic": ("italic", "regular"),
    "bolditalic": ("bolditalic", "bold", "italic", "regular"),
}
_SUBSET_PREFIX = re.compile(r"^[A-Z]{6}\+")
# Suffixes stripped one at a time from a normalized name until it matches an alias.
_SUFFIXES = ("regular", "bolditalic", "boldoblique", "bold", "italic", "oblique", "roman", "book", "mt", "ps")
_BOLD_WORDS = ("bold", "black", "heavy", "semibold", "demibold", "demi")
_ITALIC_WORDS = ("italic", "oblique")
FLAG_ITALIC, FLAG_SERIF, FLAG_MONO, FLAG_BOLD = 2, 4, 8, 16  # pymupdf TEXT_FONT_* span flags


def style_key(bold: bool, italic: bool) -> str:
    if bold and italic:
        return "bolditalic"
    if bold:
        return "bold"
    if italic:
        return "italic"
    return "regular"


def base_font_name(name: str) -> str:
    """The PDF font name without its subset prefix (`ABCDEF+Calibri-Bold` → `Calibri-Bold`)."""
    return _SUBSET_PREFIX.sub("", name or "")


def parse_font_name(name: str) -> tuple[str, bool, bool]:
    """(family key, bold, italic) from a PDF font name. The key is lowercase alphanumerics of the
    part before the first `-` or `,` (`Arial,BoldItalic` → `arial`, `Times New Roman` → `timesnewroman`)."""
    base = base_font_name(name)
    lowered = base.lower()
    bold = any(w in lowered for w in _BOLD_WORDS)
    italic = any(w in lowered for w in _ITALIC_WORDS)
    family = re.split(r"[-,]", base, maxsplit=1)[0]
    key = re.sub(r"[^a-z0-9]", "", family.lower())
    return key, bold, italic


class FontRegistry:
    def __init__(self, fonts_dir: Path):
        self._dir = Path(fonts_dir)
        self._manifest = json.loads((self._dir / "manifest.json").read_text())
        self._cache: dict[tuple[str, bool, bool], pymupdf.Font] = {}
        self._aliases: dict[str, str] = {}
        for family, info in self._manifest["families"].items():
            for alias in info.get("aliases", []):
                self._aliases[alias] = family

    def families(self) -> list[str]:
        return list(self._manifest["families"].keys())

    def category(self, family: str) -> str:
        fam = self._manifest["families"].get(family)
        if fam is None:
            raise UnknownFont(family)
        return fam["category"]

    def path(self, family: str, bold: bool, italic: bool) -> Path:
        fam = self._manifest["families"].get(family)
        if fam is None:
            raise UnknownFont(family)
        for style in _STYLE_FALLBACK[style_key(bold, italic)]:
            if style in fam["files"]:
                return self._dir / "files" / fam["files"][style]
        raise UnknownFont(f"{family} has no regular style")

    def font(self, family: str, bold: bool, italic: bool) -> pymupdf.Font:
        key = (family, bold, italic)
        if key not in self._cache:
            self._cache[key] = pymupdf.Font(fontfile=str(self.path(family, bold, italic)))
        return self._cache[key]

    def match(self, name: str) -> str | None:
        """The registry family whose alias matches the PDF font name, else None."""
        key, _, _ = parse_font_name(name)
        while key:
            if key in self._aliases:
                return self._aliases[key]
            for suffix in _SUFFIXES:
                if key.endswith(suffix) and len(key) > len(suffix):
                    key = key[: -len(suffix)]
                    break
            else:
                return None
        return None

    def substitute(self, name: str, flags: int = 0) -> dict:
        """The bundled FontRef (as JSON) used in place of the PDF font `name`: alias match first,
        else by span flags (serif → Tinos, mono → Cousine, otherwise Arimo). Bold/italic come
        from the name and the flags."""
        _, name_bold, name_italic = parse_font_name(name)
        family = self.match(name)
        if family is None:
            fallback = self._manifest["fallback"]
            if flags & FLAG_MONO:
                family = fallback["mono"]
            elif flags & FLAG_SERIF:
                family = fallback["serif"]
            else:
                family = fallback["sans"]
        return {
            "kind": "bundled",
            "family": family,
            "bold": name_bold or bool(flags & FLAG_BOLD),
            "italic": name_italic or bool(flags & FLAG_ITALIC),
        }
```

Run: `cd apps/api && uv run pytest -q`
Expected: all pass (the M1 bake tests still use Arimo/Tinos).

- [ ] **Step 7: Web style fallback (failing test first)**

Append to `apps/web/src/lib/fonts.test.ts` and add `pickFile` to its import from `@/lib/fonts`:
```ts
describe("pickFile", () => {
  it("picks the nearest style a family has (same order as the API)", () => {
    expect(pickFile({ regular: "R.ttf", bold: "B.ttf" }, "bolditalic")).toBe("B.ttf");
    expect(pickFile({ regular: "R.ttf", bold: "B.ttf" }, "italic")).toBe("R.ttf");
    expect(pickFile({ regular: "R.ttf" }, "bold")).toBe("R.ttf");
    expect(() => pickFile({}, "regular")).toThrow("no regular style");
  });
});
```

Run: `npm test -w apps/web` → Expected: FAIL (`pickFile` is not exported).

In `apps/web/src/lib/fonts.ts`:
- Replace `function style(f: BundledFont): "regular" | "bold" | "italic" | "bolditalic" {` with:
```ts
export type Style = "regular" | "bold" | "italic" | "bolditalic";

function style(f: BundledFont): Style {
```
- Below `style()` add:
```ts
/** Styles to try when a family lacks the requested one — same order as the API's FontRegistry.path. */
const STYLE_FALLBACK: Record<Style, Style[]> = {
  regular: ["regular"],
  bold: ["bold", "regular"],
  italic: ["italic", "regular"],
  bolditalic: ["bolditalic", "bold", "italic", "regular"],
};

export function pickFile(files: Partial<Record<Style, string>>, wanted: Style): string {
  for (const s of STYLE_FALLBACK[wanted]) if (files[s]) return files[s]!;
  throw new Error("font family has no regular style");
}
```
- Change the manifest type to `interface Manifest { default: string; families: Record<string, { category: string; files: Partial<Record<Style, string>> }> }`.
- In `FontStore.load`, replace the line that builds the font URL from `fam.files[style(f)]` with:
```ts
        const url = `${this.baseUrl}/${pickFile(fam.files, style(f))}`;
```

`apps/web/scripts/sync-fonts.mjs`: change the import to `import { cp, mkdir, rm } from "node:fs/promises";` and insert `await rm(dest, { recursive: true, force: true }); // drop files no longer in the manifest` right before `await mkdir(dest, { recursive: true });`.

Run: `npm test -w apps/web && npx tsc --noEmit -p apps/web && npm run lint -w apps/web`
Expected: all pass, 0 lint problems.

- [ ] **Step 8: Commit**

```bash
git add packages/fonts apps/api/edith/fonts.py apps/api/tests/test_fonts.py apps/web/src/lib/fonts.ts apps/web/src/lib/fonts.test.ts apps/web/scripts/sync-fonts.mjs
git commit -m "feat(fonts): 21-family registry with style fallback and PDF font substitutes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
