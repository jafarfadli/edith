# Font set for common documents: research

Request: "fontnya bisa diperkaya lagi untuk dokumen yang umum, misalnya Times New Roman masa gak ada sih". Times New Roman, Arial, Courier New, Calibri and Cambria were already covered by metric-compatible families (Tinos, Arimo, Cousine, Carlito, Caladea), but the picker only showed those names, so nobody saw them. Everything else (Georgia, Verdana, Tahoma, Palatino/Book Antiqua, Bookman Old Style, Century Gothic, Arial Narrow, Garamond...) fell back to Arimo or Tinos by PDF flags.

## Method

1. Which fonts matter: Office's default and "web-safe" sets as they appear in Indonesian government letters (surat dinas, nota dinas: Times New Roman, Arial, Bookman Old Style, Arial Narrow, Tahoma, Century Gothic, Cambria, Calibri), CVs and invoices (Calibri, Cambria, Arial, Aptos, Segoe UI, Trebuchet), contracts and academic papers (Times New Roman, Garamond, Book Antiqua/Palatino, Georgia, Cambria), and forms (Arial, Courier New, Verdana, Tahoma).
2. Candidate substitutes: free and redistributable only (OFL, Apache, Vera/DejaVu, AGPL with the PDF-embedding exception of URW++), taken from Google Fonts, the DejaVu release on npm, Microsoft's Selawik release and the URW++ base 35 set. Known metric-compatible pairs come from Chrome OS "crosextra" and fontconfig's `30-metric-aliases.conf` (Arimo, Tinos, Cousine, Carlito, Caladea, Gelasio; Liberation Sans Narrow for Arial Narrow).
3. Measured instead of guessed: the originals are on the owner's Mac (macOS Supplemental fonts, Microsoft Word's DFonts, including Aptos). For each pair the sum of the advance widths of a 560-character Indonesian/English paragraph (letters, digits, `Rp 1.250.000,00`, `Bapak/Ibu`) in the substitute is divided by that of the original (fontTools, no kerning). 1.00 = same line breaks; this is what decides whether an edited line still fits its box. The measurement was local only; no Microsoft font is copied into the repository.
4. Coverage: Indonesian is plain Latin, so what matters is Basic Latin, Latin-1, Latin Extended-A and the punctuation and currency block (en/em dash, quotes, bullet, ellipsis, euro, pound). The API test checks every substitute draws them in all four styles; the web test checks that fontkit parses and measures every file.

## Result

Width ratio = substitute / original (Latin sample). Licences are in `packages/fonts/LICENSES.md`.

| Document font | Chosen (id) | Width | Styles | Licence | Runner-up measured |
|---|---|---|---|---|---|
| Times New Roman | Tinos (already) | exact | 4 | Apache 2.0 | |
| Arial / Helvetica | Arimo (already) | exact | 4 | Apache 2.0 | |
| Courier New | Cousine (already) | exact | 4 | Apache 2.0 | |
| Calibri | Carlito (already) | exact | 4 | OFL | |
| Cambria | Caladea (already) | exact | 4 | Apache 2.0 | |
| Georgia | Gelasio | 1.000 | 4 | OFL | PT Serif 0.997, Lora 1.04, Tinos 0.90 |
| Verdana | DejaVu Sans (subset) | 0.990 | 4 | Vera/DejaVu | Montserrat 0.98, Open Sans 0.91 |
| Tahoma | Open Sans (already bundled) | 1.047 | 4 | OFL | Nunito Sans 1.007, Fira Sans 1.018, Lato 0.973, Noto Sans 1.059 |
| Trebuchet MS | Fira Sans (subset) | 1.006 | 4 | OFL | Nunito Sans 0.995, Ubuntu 0.999 (Ubuntu licence, not OFL), Open Sans 1.035 |
| Segoe UI | Selawik | exact by design (Microsoft's own replacement; Segoe UI is not on the test Mac) | regular, bold | OFL (RFN "Selawik", files untouched) | Open Sans, Noto Sans (wider) |
| Aptos (Word's new default) | Roboto (already bundled) | 1.037 | 4 | OFL | Lato 1.011, Source Sans 3 0.973, Arimo 1.040, Carlito 0.950, Inter 1.102 |
| Palatino Linotype / Book Antiqua | P052 (URW, subset) | 1.000 | 4 | AGPL-3.0 + PDF exception | Gelasio 0.999 (shape differs), Tinos 0.90 |
| Bookman Old Style | URW Bookman (subset) | 1.000 | 4 (Light/Demi as regular/bold) | AGPL-3.0 + PDF exception | Merriweather 0.968 |
| Century Gothic | URW Gothic (subset) | 1.000 | 4 (Book/Demi) | AGPL-3.0 + PDF exception | Poppins 1.030, Montserrat 1.035, Questrial 0.919 |
| Arial Narrow | Archivo Narrow | 1.007 | 4 | OFL | Nimbus Sans Narrow 1.000 (AGPL), PT Sans Narrow 0.944, Roboto Condensed 1.079 |
| Arial Black | Archivo Black | 1.000 | regular | OFL | |
| Garamond | EB Garamond (subset) | 0.985 | 4 | OFL | Crimson Pro 1.024, Tinos 1.033 |
| Comic Sans MS | Comic Neue | 0.936 | 4 | OFL | Cabin 0.908 |
| Impact | Anton | 0.988 | regular | OFL | Roboto Condensed 0.973, Oswald 0.889 |
| Franklin Gothic | Libre Franklin | 1.082 (Book) | 4 | OFL | Lato 1.015, Cabin 0.982 |
| Gill Sans | Cabin | 1.039 | 4 | OFL | Alegreya Sans 0.961, Jost 1.054 |
| Futura | Jost | 0.921 | 4 | OFL | Questrial 0.967, Poppins 1.083 |
| Rockwell | Aleo | 0.996 | 4 | OFL | Bitter 1.010, Roboto Slab 1.034, Zilla Slab 0.940, Arvo 1.058 |
| Consolas | Inconsolata | 0.909 | regular, bold | OFL | Cousine / Source Code Pro / JetBrains Mono 1.091 (Consolas is 0.55 em: no free mono matches it) |
| Lucida Sans (Unicode), Lucida Grande | DejaVu Sans | 1.033 | | | Open Sans 0.952 |
| Lucida Console, Lucida Sans Typewriter | Cousine | exact (0.6 em) | | | |
| Candara, Corbel (Office's ClearType set) | Carlito (alias) | 0.973 / 0.990 | | | Cabin 1.002 (Candara) |
| Constantia | Caladea (alias) | 0.946 | | | Lora 1.068 |
| Calibri Light, Cambria Math | Carlito, Caladea (alias) | | | | math glyphs of Cambria Math do not exist in Caladea |
| Helvetica Neue, Microsoft Sans Serif, Arial Unicode MS | Arimo (alias) | | | | |
| SF Pro / system-ui / `.AppleSystemUIFont` | Inter (alias) | look-alike | | OFL | |
| Myriad Pro | Source Sans 3 (alias) | look-alike | | OFL | |
| Times (Mac) | Tinos (alias, already) | | | | |
| Symbol, Wingdings, Webdings, ZapfDingbats | none | | | | symbol fonts map letters to pictograms; no free font has the same encoding, and the document's embedded font is kept |

Why these picks where several ran close:

- **Tahoma → Open Sans**, not Nunito Sans: Tahoma is a humanist sans with open apertures; Open Sans is the closest look-alike already shipped (no new bytes), +4.7 % wide. Nunito Sans has rounded terminals.
- **Trebuchet MS → Fira Sans**: flared humanist strokes and the same width within 1 %.
- **Aptos → Roboto**: Aptos is a neo-grotesque; Roboto matches that look and is 3.7 % wider. Lato is 1 % wider but humanist. Microsoft itself shows Calibri when Aptos is missing, which changes line breaks; there is no free Aptos clone. A new project, Akasia (Codeberg, June 2026, "metric-compatible Aptos"), turned up in search: one commit, unverified, not adopted. Revisit.
- **Rockwell → Aleo**: Arvo (the nearest geometric slab) is Latin-1 only on Google Fonts (no Ł, ş, ğ, euro), which fails the Latin-ext requirement. Aleo has italics and the full range.
- **Century Gothic / Palatino / Bookman → URW++**: no OFL family has these metrics (Century Gothic and ITC Avant Garde share metrics, so URW Gothic is exact; likewise P052 for Palatino and URW Bookman for Bookman). Their licence is AGPL-3.0 with an exception that allows embedding in PDF documents whatever their licence, which is exactly what Edith does. The TeX Gyre versions (Adventor, Pagella, Bonum) are OTF/CFF and under the GUST licence that forbids modified versions under the same name, so the TTFs of URW++ 20200910 were preferred. These three are the only AGPL families; they can be dropped from `manifest.json` and `sources.json` without touching code if the owner prefers.
- **Arial Narrow → Archivo Narrow**: within 0.7 % of Arial Narrow and OFL, so no need for Nimbus Sans Narrow (AGPL, exact).
- **Verdana → DejaVu Sans**: DejaVu/Bitstream Vera was drawn with Verdana's wide proportions; fontconfig maps Verdana to it. Montserrat is as wide but geometric.
- **Segoe UI → Selawik**: no italics (italic uses the upright), 348 glyphs (Latin-1 and Extended-A in part, no Vietnamese, no U+00A0 which the editor never sends).

## Decisions

- **Storage of a document font**: the stored family stays the real id (`"Tinos"`, `"Gelasio"`). Ops, drafts, the bake, the API and `/text` need no change; old drafts load as before. A new manifest field `display` is only a label, and `common` lists the top group. The picker option's `value` is the id, which the e2e test checks, and so is the draft.
- **One family, one label**: the top group needs a distinct family per document font so a `<select>` can show the chosen one. Tahoma got Open Sans, Aptos got Roboto, and so on; other document names share a family by alias only (Candara, Corbel → Carlito).
- **Native `<select>` with `<optgroup>`**: keeps keyboard and screen-reader behaviour and the existing tests. A native option cannot style its secondary text, so it reads "Times New Roman · Tinos". The closed field is capped at 10rem and truncated, so the toolbar keeps its width on narrow windows (there is an e2e test for that).
- **Repository size**: new files are committed like the existing ones (a fresh clone needs no fetch; only the CJK pack is fetched). The big families are subset to Basic Latin, Latin-1/Ext-A/B, Vietnamese, punctuation, currency, arrows, math and shapes (`fetch-extra.py`): DejaVu Sans 3.0 MB → 0.72 MB, EB Garamond 1.56 MB → 0.61 MB, Fira Sans 1.2 MB → 0.65 MB, URW ×3 2.3 MB → 1.3 MB. Added: 58 TTFs, 5.9 MB on disk, about 3.1 MB compressed in git (the existing 86 fonts are 22 MB).
- **Reproducibility**: `packages/fonts/sources.json` + `scripts/fetch-extra.py` (called by `npm run fetch -w packages/fonts`, needs `uv`) rebuild exactly these files from Google Fonts, jsdelivr (DejaVu 2.37.3), the Selawik 1.01 release and URW++ tag 20200910.

## Not added (and why)

Century Schoolbook (C059), Monotype Corsiva (Z003), Lucida Bright/Calligraphy/Handwriting, Tw Cen MT, Perpetua, Calisto, Goudy, Copperplate, Haettenschweiler: rare in Indonesian office documents; C059 and Z003 are in the same URW++ set if wanted later (one `sources.json` entry each). Cambria Math, Symbol, Wingdings: see the table.
