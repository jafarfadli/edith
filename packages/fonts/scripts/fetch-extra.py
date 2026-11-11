"""Downloads the document-font families listed in ../sources.json into ../files and checks them against manifest.json.

Run through fetch.mjs (`npm run fetch -w packages/fonts`), or by hand:
    uv run --no-project --with fonttools python packages/fonts/scripts/fetch-extra.py [Family ...]
Families with "subset": true are cut down to the characters Indonesian and English documents use (the full
fonts are 3-4x bigger); the glyphs, kerning and other layout features that remain are untouched.
"""
import io
import json
import re
import sys
import urllib.request
import zipfile
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "files"
STYLES = ("regular", "bold", "italic", "bolditalic")
GOOGLE_TUPLE = {"regular": (0, 400), "bold": (0, 700), "italic": (1, 400), "bolditalic": (1, 700)}

# Basic Latin, Latin-1, Latin Extended-A/B, spacing and combining marks, Latin Extended Additional (Vietnamese),
# general punctuation, currency, letterlike symbols, arrows, math operators, geometric shapes, fi/fl ligatures.
SUBSET_UNICODES = (
    "U+0000-024F,U+02B0-02FF,U+0300-036F,U+1E00-1EFF,U+2000-206F,U+20A0-20CF,U+2100-214F,U+2190-21FF,"
    "U+2200-22FF,U+25A0-25FF,U+FB00-FB06,U+FEFF,U+FFFD"
)


def get(url: str, ua: str = "Mozilla/5.0") -> bytes:
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": ua}), timeout=120) as res:
        return res.read()


def google_files(family: str, styles: list[str]) -> dict[str, bytes]:
    """One static TTF per style from the Google Fonts CSS API (an old user agent gets TTF, not woff2 subsets)."""
    tuples = sorted({GOOGLE_TUPLE[s] for s in styles})
    spec = family.replace(" ", "+")
    if len(tuples) > 1 or tuples[0] != (0, 400):
        italics = any(i for i, _ in tuples)
        if italics:
            spec += ":ital,wght@" + ";".join(f"{i},{w}" for i, w in tuples)
        else:
            spec += ":wght@" + ";".join(str(w) for _, w in tuples)
    css = get(f"https://fonts.googleapis.com/css2?family={spec}", ua="Mozilla/4.0").decode()
    served: dict[str, str] = {}
    for block in css.split("@font-face")[1:]:
        italic = re.search(r"font-style:\s*(\w+)", block).group(1) == "italic"
        weight = int(re.search(r"font-weight:\s*(\d+)", block).group(1))
        style = next((s for s, t in GOOGLE_TUPLE.items() if t == (int(italic), weight)), None)
        if style:
            served[style] = re.search(r"url\((https:[^)]+\.ttf)\)", block).group(1)
    missing = [s for s in styles if s not in served]
    if missing:
        raise SystemExit(f"{family}: Google Fonts does not serve {', '.join(missing)}")
    return {s: get(served[s]) for s in styles}


def cut(data: bytes) -> bytes:
    options = subset.Options()
    options.layout_features = ["*"]
    options.name_IDs = ["*"]
    options.name_languages = ["*"]
    options.notdef_outline = True
    options.glyph_names = False
    options.legacy_kern = True
    options.drop_tables += ["DSIG"]
    font = TTFont(io.BytesIO(data))
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=subset.parse_unicodes(SUBSET_UNICODES))
    subsetter.subset(font)
    out = io.BytesIO()
    font.save(out)
    return out.getvalue()


def main() -> None:
    manifest = json.loads((ROOT / "manifest.json").read_text())
    sources = {k: v for k, v in json.loads((ROOT / "sources.json").read_text()).items() if not k.startswith("_")}
    wanted = sys.argv[1:] or list(sources)
    OUT.mkdir(exist_ok=True)
    for family in wanted:
        src, info = sources[family], manifest["families"][family]
        styles = list(info["files"])
        if src.get("google"):
            blobs = google_files(family, styles)
        elif "urls" in src:
            blobs = {s: get(src["urls"][s]) for s in styles}
        else:
            archive = zipfile.ZipFile(io.BytesIO(get(src["zip"])))
            blobs = {s: archive.read(src["members"][s]) for s in styles}
        for style, data in blobs.items():
            if src.get("subset"):
                data = cut(data)
            (OUT / info["files"][style]).write_bytes(data)
            print("saved", info["files"][style], len(data))


if __name__ == "__main__":
    main()
