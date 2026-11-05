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
