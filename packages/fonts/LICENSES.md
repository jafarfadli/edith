# Font licenses

All files in `files/` are static TTFs, fetched by `scripts/fetch.mjs` (and `scripts/fetch-extra.py` for the families of `sources.json`). Every family is free to redistribute and to embed in PDF documents.

| Families | License |
|---|---|
| Arimo, Tinos, Cousine (metric-compatible with Arial, Times New Roman, Courier New) | Apache License 2.0 |
| Caladea (metric-compatible with Cambria) | Apache License 2.0 |
| Carlito (metric-compatible with Calibri) | SIL Open Font License 1.1 |
| Gelasio (metric-compatible with Georgia) | SIL Open Font License 1.1 |
| Selawik (metric-compatible with Segoe UI; Microsoft, files unmodified) | SIL Open Font License 1.1 |
| Fira Sans (Trebuchet MS), EB Garamond (Garamond), Comic Neue (Comic Sans MS), Anton (Impact), Archivo Black (Arial Black), Archivo Narrow (Arial Narrow), Libre Franklin (Franklin Gothic), Cabin (Gill Sans), Jost (Futura), Aleo (Rockwell), Inconsolata (Consolas) | SIL Open Font License 1.1 |
| DejaVu Sans (Verdana, Lucida Sans) | Bitstream Vera / DejaVu license (free to use, copy, modify and redistribute; the names "Bitstream" and "Vera" may not be used for modified versions) |
| P052 (Palatino, Book Antiqua), URW Bookman (Bookman Old Style), URW Gothic (Century Gothic): URW++ base 35 set | GNU Affero General Public License 3.0 with the special exception that the fonts may be included in a PDF or PostScript document regardless of that document's license |
| Inter, Roboto, Open Sans, Lato, Montserrat, Poppins, Source Sans 3, Lora, Playfair Display, Source Serif 4, PT Serif, JetBrains Mono, Noto Sans, Noto Serif, Merriweather, Dancing Script, Caveat, Great Vibes, Sacramento | SIL Open Font License 1.1 |

Subsets: DejaVu Sans, Fira Sans, EB Garamond, P052, URW Bookman and URW Gothic are cut down by `scripts/fetch-extra.py` to Basic Latin, Latin-1, Latin Extended-A/B, Vietnamese, punctuation, currency, arrows, math operators and geometric shapes (every glyph kept is unchanged, kerning and the other layout features are kept). Characters outside those blocks (Cyrillic, Greek, CJK...) are drawn by the editor's fallback fonts. The other families are the files as published.

The URW++ fonts (AGPL-3.0 with the PDF-embedding exception) come from https://github.com/ArtifexSoftware/urw-base35-fonts (tag 20200910); the exception reads: "permission is granted to include these font programs in a Postscript or PDF file that consists of a document that contains text to be displayed or printed using this font, regardless of the conditions or license applying to the document itself". The font files are the corresponding source of themselves.

The optional CJK pack in `files/cjk/` (Noto Sans KR/JP/SC, Noto Serif KR/JP/SC) is downloaded by `scripts/fetch-cjk.mjs` from Google Fonts and is not committed; SIL Open Font License 1.1.

Apache License 2.0: https://www.apache.org/licenses/LICENSE-2.0 — SIL OFL 1.1: https://openfontlicense.org — AGPL 3.0: https://www.gnu.org/licenses/agpl-3.0.html — DejaVu: https://dejavu-fonts.github.io/License.html
