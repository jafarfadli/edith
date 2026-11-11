# @edith/fonts

The fonts Edith draws and bakes text with. The web (`apps/web/src/lib/fonts.ts`, synced to `public/fonts` by `scripts/sync-fonts.mjs`) and the API (`apps/api/edith/fonts.py`) read the same `manifest.json`.

```
manifest.json            families, files, aliases, picker names
sources.json             where fetch-extra.py gets each document-font family (and whether it is subset)
files/*.ttf              committed TTFs (the CJK pack in files/cjk is not: scripts/fetch-cjk.mjs)
scripts/fetch.mjs        Google Fonts families whole; then runs fetch-extra.py
scripts/fetch-extra.py   document fonts: Google Fonts / jsdelivr / GitHub releases, subsetting (needs uv)
LICENSES.md              licence of every family
```

## manifest.json

| Key | Meaning |
|---|---|
| `families.<id>` | The family **id** is what ops store (`{"kind":"bundled","family":"Tinos"}`). Ids never change: old drafts must load. |
| `category` | `sans` \| `serif` \| `mono` \| `script`: picker group, and the design of the fallback for a character the font lacks. |
| `files` | `regular` (required), `bold`, `italic`, `bolditalic`. A missing style falls back (bold italic → bold → italic → regular). |
| `aliases` | Lowercase alphanumerics of PDF font names (`parse_font_name`) that this family stands in for. Unique across families. Style words and `MT`/`PS` suffixes are stripped before matching, so `Georgia-BoldItalic` and `ABCDEF+GeorgiaMT` both hit `georgia`. |
| `display` | The familiar name the picker shows first (`Times New Roman`), with the id as small secondary text (`Tinos`). Display only: choosing it stores the id. |
| `common` (root) | Ids shown in the picker's top group, in order. Each has a `display`, all different. |
| `fallback` (root) | Family for an unknown font by design (`sans`, `serif`, `mono`). |

To add a family: put the TTFs in `files/`, add the entry (and a `sources.json` entry so `npm run fetch -w packages/fonts` reproduces it), a row in `LICENSES.md` and in the table below, then `cd apps/api && uv run pytest tests/test_fonts.py` (checks files, unique aliases, coverage of Latin-1/Latin-Ext text).

## PDF font → bundled substitute

Metric = width of an Indonesian/English sample paragraph in the substitute divided by the original's (1.00 = same line breaks). "Exact" = metric-compatible by design.

| PDF font names | Substitute (id) | Metric | Licence |
|---|---|---|---|
| Times New Roman, Times | Tinos | exact | Apache 2.0 |
| Arial, Helvetica, Helvetica Neue, MS Sans Serif, Arial Unicode MS | Arimo | exact | Apache 2.0 |
| Courier New, Courier, Lucida Console, Aptos Mono | Cousine | exact | Apache 2.0 |
| Calibri, Calibri Light, Candara, Corbel | Carlito | exact (Calibri); 0.97 / 0.99 | OFL |
| Cambria, Cambria Math, Constantia | Caladea | exact (Cambria); 0.95 | Apache 2.0 |
| Georgia | Gelasio | exact | OFL |
| Verdana, Lucida Sans (Unicode), Lucida Grande | DejaVu Sans | 0.99 / 1.03 | Vera/DejaVu |
| Tahoma | Open Sans | 1.05 | OFL |
| Trebuchet MS | Fira Sans | 1.01 | OFL |
| Segoe UI (Light, Semibold, Black) | Selawik | exact (Microsoft's replacement); no italics | OFL |
| Aptos (Display, Light, SemiBold...) | Roboto | 1.04 (look-alike) | OFL |
| Palatino, Palatino Linotype, Book Antiqua, Palladio | P052 | exact | AGPL-3.0 + PDF exception |
| Bookman Old Style, Bookman, ITC Bookman | URW Bookman | exact | AGPL-3.0 + PDF exception |
| Century Gothic, Avant Garde, ITC Avant Garde Gothic | URW Gothic | exact | AGPL-3.0 + PDF exception |
| Arial Narrow, Helvetica Narrow, Nimbus Sans Narrow, Aptos Narrow | Archivo Narrow | 1.01 | OFL |
| Arial Black | Archivo Black | 1.00 | OFL |
| Garamond, Adobe Garamond Pro, Garamond Premier Pro | EB Garamond | 0.99 | OFL |
| Comic Sans MS | Comic Neue | 0.94 | OFL |
| Impact | Anton | 0.99 | OFL |
| Franklin Gothic (Book, Medium, Demi, Heavy) | Libre Franklin | 1.08 | OFL |
| Gill Sans (MT) | Cabin | 1.04 | OFL |
| Futura (PT, BT) | Jost | 0.92 | OFL |
| Rockwell | Aleo | 1.00 | OFL |
| Consolas | Inconsolata | 0.91 (Consolas is 0.55 em, Inconsolata 0.5) | OFL |
| San Francisco / system-ui (`.SFNSText`, SF Pro, `.AppleSystemUIFont`) | Inter | look-alike | OFL |
| Myriad Pro | Source Sans 3 | look-alike | OFL |
| Symbol, Wingdings, Webdings, ZapfDingbats | none: symbol fonts have no Unicode text to substitute; the document's own embedded font is kept | | |

Anything else falls back by its PDF flags: serif → Tinos, monospace → Cousine, otherwise Arimo; CJK names use the optional Noto CJK pack.

## Picker

`apps/web/src/lib/fontPicker.ts` builds the font picker from the manifest: group "Umum / Dokumen" (`common`, in order, familiar name + id), then Sans, Serif, Mono, Script (alphabetical, by display name, without the families already in the top group).
