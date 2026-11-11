import json

import pymupdf
import pytest

from edith.fonts import STYLES, FontRegistry, UnknownFont, base_font_name, cjk_style, family_key, parse_font_name
from edith.settings import Settings
from tests.pdfs import fake_cjk_pack


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


def test_family_key_is_shared_by_the_styles_of_a_family():
    assert family_key("TimesNewRomanPSMT") == family_key("ABCDEF+TimesNewRomanPS-BoldItalicMT") == "timesnewroman"
    assert family_key("ArialMT") == family_key("Arial-BoldMT") == family_key("Arial,Italic") == "arial"
    assert family_key("Calibri") == family_key("Calibri-Bold") == "calibri"
    assert family_key("Tinos Regular") == "tinos" and family_key("Dotum") == "dotum"


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


def test_cjk_manifest_entries():
    manifest = json.loads((Settings().fonts_dir / "manifest.json").read_text())
    assert set(manifest["cjk"]) == {f"Noto {d} {s}" for d in ("Sans", "Serif") for s in ("KR", "JP", "SC")}
    for family, info in manifest["cjk"].items():
        assert (info["category"], info["script"]) == ("serif" if "Serif" in family else "sans", family[-2:].lower())
        assert set(info["files"]) == {"regular", "bold"}
        assert all(f.startswith("cjk/") and f.endswith(".ttf") for f in info["files"].values())


@pytest.mark.parametrize("name,style", [
    ("INPILL+Dotum", ("kr", "sans")), ("DotumChe", ("kr", "sans")), ("Gulim", ("kr", "sans")),
    ("Malgun Gothic,Bold", ("kr", "sans")), ("Haansoft Batang", ("kr", "serif")), ("HYMyeongJo-Medium", ("kr", "serif")),
    ("MS-Mincho", ("jp", "serif")), ("MS PGothic", ("jp", "sans")), ("KozMinPr6N-Regular", ("jp", "serif")),
    ("SimSun", ("sc", "serif")), ("Microsoft YaHei", ("sc", "sans")), ("PMingLiU", ("sc", "serif")),
    ("NotoSansCJKjp-Regular", ("jp", "sans")), ("NotoSerifKR-Bold", ("kr", "serif")),
    ("HYSinMyeongJo-Medium", ("kr", "serif")), ("AdobeMyungjoStd-Medium", ("kr", "serif")),
    ("AdobeSongStd-Light", ("sc", "serif")), ("AdobeMingStd-Light", ("sc", "serif")), ("Song", ("sc", "serif")),
    ("Ming-Light", ("sc", "serif")), ("DFKai-SB", ("sc", "serif")), ("BiauKai", ("sc", "serif")),
    ("SourceHanSansKR-Regular", ("kr", "sans")), ("SourceHanSerifJP-Bold", ("jp", "serif")),
    ("ABCDEF+SourceHanSansCN-Light", ("sc", "sans")), ("SourceHanSerifTW-Regular", ("sc", "serif")),
    ("SourceHanSans-Regular", None), ("HiraMinProN-W3", ("jp", "serif")), ("HiraKakuStdN-W8", ("jp", "sans")),
    ("NotoSansMonoCJKkr-Regular", ("kr", "sans")), ("NotoSansMonoCJKtc-Bold", ("sc", "sans")),
    ("NotoSansCJKhk-Regular", ("sc", "sans")), ("Noto Serif CJK SC", ("sc", "serif")),
    ("Arial", None), ("Century Gothic", None), ("Wingdings", None), ("TimesNewRomanPSMT", None),
    ("Franklin Gothic Medium", None), ("LetterGothic", None), ("MinionPro-Regular", None), ("Kaiser", None),
    ("Mingler", None), ("Songbird", None),
])
def test_cjk_style(name, style):
    assert cjk_style(name) == style


def test_cjk_pack_present(tmp_path):
    reg = FontRegistry(fake_cjk_pack(tmp_path / "fonts"))
    assert (reg.cjk("kr", "sans"), reg.cjk("kr", "serif"), reg.cjk("kr", "mono")) == ("Noto Sans KR", "Noto Serif KR", "Noto Sans KR")
    assert reg.cjk("jp", "sans") is None  # only the Korean files are there
    assert reg.path("Noto Sans KR", True, False).name == "NotoSansKR-Regular.ttf"  # no bold file: regular
    assert reg.font("Noto Serif KR", False, False).has_glyph(ord("한"))
    assert reg.category("Noto Serif KR") == "serif"
    assert reg.substitute("EDITHA+Dotum") == {"kind": "bundled", "family": "Noto Sans KR", "bold": False, "italic": False}
    assert reg.substitute("Haansoft Batang", 4)["family"] == "Noto Serif KR"
    assert reg.substitute("MS-Mincho", 4)["family"] == "Tinos"  # Japanese files missing: by flags as before
    assert "Noto Sans KR" not in reg.families()  # pack families are fallbacks, not choices in the font picker


def test_cjk_pack_absent(tmp_path):
    root = tmp_path / "fonts"
    (root / "files").mkdir(parents=True)
    (root / "manifest.json").write_bytes((Settings().fonts_dir / "manifest.json").read_bytes())
    reg = FontRegistry(root)
    assert reg.cjk("kr", "sans") is None
    assert reg.substitute("EDITHA+Dotum")["family"] == "Arimo"
    with pytest.raises(UnknownFont):
        reg.path("Noto Sans KR", False, False)
