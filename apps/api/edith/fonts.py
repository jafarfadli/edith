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

# CJK font names (normalized: lowercase alphanumerics) → script of the optional fallback pack (manifest "cjk").
_CJK_NAMES = {
    "kr": ("dotum", "gulim", "batang", "gungsuh", "malgun", "nanum", "haansoft", "hancom", "hymyeongjo", "hygothic",
           "hygungso", "hyheadline", "applegothic", "applemyungjo", "undotum", "unbatang", "baekmuk", "myeongjo", "myungjo"),
    "jp": ("msgothic", "mspgothic", "msuigothic", "msmincho", "mspmincho", "mincho", "meiryo", "yugothic", "hiragino",
           "kozuka", "kozmin", "kozgo", "ipagothic", "ipaexgothic", "takao", "hiramin", "hirakaku", "hiramaru"),
    "sc": ("simsun", "simhei", "simkai", "kaiti", "fangsong", "songti", "heiti", "yahei", "pingfang", "stsong",
           "stheiti", "stkaiti", "dengxian", "mingliu", "jhenghei", "adobesong", "adobeming", "dfkai", "biaukai"),
}
# Too short to match inside a name (Mingler, Songbird, Kaiser...): only the whole name, with weight words ("Song", "Ming-Light").
_CJK_WHOLE = re.compile(r"(song|ming)(light|medium|regular|bold|std|pro|w\d)*")
# Noto Sans (Mono) / Serif CJK and Source Han Sans / Serif: one family for every script, told apart by a suffix.
_NOTO_CJK = re.compile(r"noto(sans|serif)(mono)?(cjk)?(kr|jp|sc|tc|hk)")
_SOURCE_HAN = re.compile(r"sourcehan(sans|serif)(kr|jp|sc|tc|cn|hk|tw)")
_SCRIPT_OF_SUFFIX = {"kr": "kr", "jp": "jp", "sc": "sc", "tc": "sc", "cn": "sc", "hk": "sc", "tw": "sc"}
# Words of serif (Myeongjo / Mincho / Song) CJK designs; any other CJK font is matched with a gothic (sans) one.
_CJK_SERIF = ("batang", "gungsuh", "myeongjo", "myungjo", "mincho", "kozmin", "song", "simsun", "ming", "kai",
              "fangsong", "serif", "hiramin")


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


def cjk_style(name: str) -> tuple[str, str] | None:
    """(script, category) of the fallback for a CJK font name — script "kr" | "jp" | "sc" (Traditional Chinese
    fonts use "sc"), category "sans" | "serif" — or None when the name is not a known CJK font."""
    key = re.sub(r"[^a-z0-9]", "", base_font_name(name).lower())
    family = _NOTO_CJK.search(key) or _SOURCE_HAN.search(key)
    if family:  # the family says the design; the script comes from the suffix
        return _SCRIPT_OF_SUFFIX[family.group(family.lastindex)], "serif" if family.group(1) == "serif" else "sans"
    if "sourcehan" in key:
        return None  # Source Han without a script suffix: could be any
    script = next((s for s, words in _CJK_NAMES.items() if any(w in key for w in words)), None)
    script = script or ("sc" if _CJK_WHOLE.fullmatch(key) else None)
    if script is None:
        return None
    return script, "serif" if any(w in key for w in _CJK_SERIF) else "sans"


class FontRegistry:
    def __init__(self, fonts_dir: Path):
        self._dir = Path(fonts_dir)
        self._manifest = json.loads((self._dir / "manifest.json").read_text())
        self._cache: dict[tuple[str, bool, bool], pymupdf.Font] = {}
        self._aliases: dict[str, str] = {}
        for family, info in self._manifest["families"].items():
            for alias in info.get("aliases", []):
                self._aliases[alias] = family
        # The optional CJK pack (scripts/fetch-cjk.mjs): only families whose regular file is there.
        self._cjk: dict[str, dict] = {}
        for family, info in self._manifest.get("cjk", {}).items():
            files = {s: f for s, f in info["files"].items() if (self._dir / "files" / f).is_file()}
            if "regular" in files:
                self._cjk[family] = {**info, "files": files}

    def cjk(self, script: str, category: str) -> str | None:
        """The pack family for `script` ("kr" | "jp" | "sc") in `category` ("serif" or anything else → sans),
        else the other category of that script, else None (pack not fetched)."""
        wanted = "serif" if category == "serif" else "sans"
        found = {info["category"]: family for family, info in self._cjk.items() if info["script"] == script}
        return found.get(wanted) or next(iter(found.values()), None)

    def families(self) -> list[str]:
        return list(self._manifest["families"].keys())

    def fallback(self, design: str) -> str:
        """The family standing in for an unknown font of `design` ("sans", "serif" or "mono")."""
        return self._manifest["fallback"][design]

    def _family(self, family: str) -> dict:
        fam = self._manifest["families"].get(family) or self._cjk.get(family)
        if fam is None:
            raise UnknownFont(family)
        return fam

    def category(self, family: str) -> str:
        return self._family(family)["category"]

    def path(self, family: str, bold: bool, italic: bool) -> Path:
        fam = self._family(family)
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
        """The bundled FontRef (as JSON) used in place of the PDF font `name`: alias match first, then a
        CJK font name → the pack family of its script and design (Dotum → Noto Sans KR, Batang → Noto Serif
        KR) when the pack is there, else by span flags (serif → Tinos, mono → Cousine, otherwise Arimo).
        Bold/italic come from the name and the flags."""
        _, name_bold, name_italic = parse_font_name(name)
        family = self.match(name)
        hint = cjk_style(name) if family is None else None
        if hint is not None:
            family = self.cjk(*hint)
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
