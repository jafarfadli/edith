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
    assert len(families) == 24
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
    assert registry.path("Noto Sans", True, True).name == "NotoSans-BoldItalic.ttf"
    assert registry.path("Merriweather", False, True).name == "Merriweather-Italic.ttf"


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
    ("NotoSerif-Bold", 0, "Noto Serif", True, False),
    ("Garamond", 4, "Tinos", False, False),            # unknown: serif flag
    ("Consolas", 8, "Cousine", False, False),          # unknown: mono flag
    ("Verdana", 16 | 2, "Arimo", True, True),          # unknown: sans, bold/italic from flags
])
def test_substitute(registry, name, flags, family, bold, italic):
    assert registry.substitute(name, flags) == {"kind": "bundled", "family": family, "bold": bold, "italic": italic}
