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
