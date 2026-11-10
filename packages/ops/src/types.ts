/* Generated from apps/api/edith/ops.py — do not edit. Run: npm run gen -w packages/ops */

export type Id = string;
export type Pagekey = string;
export type Opacity = number;
export type Rotation = number;
export type Type = "text.add";
export type X = number;
export type Y = number;
export type W = number;
export type H = number;
export type Align = "left" | "center" | "right" | "justify";
export type Lineheight = number;
export type Text = string;
export type Font = BundledFont | OriginalFont;
export type Kind = "bundled";
export type Family = string;
export type Bold = boolean;
export type Italic = boolean;
export type Kind1 = "original";
export type Ref = string;
export type Doc = string | null;
export type Size = number;
export type Color = string;
export type Bgcolor = string | null;
export type Underline = boolean;
export type Strike = boolean;
export type Underlinetop = number | null;
export type Striketop = number | null;
export type Decorthickness = number | null;
export type Decorcolor = string | null;
export type Hscale = number;
export type Charspacing = number;
export type Wordspacing = number;
export type Paragraphs = Run[][];
export type Baseline = number;
export type X1 = number;
export type Text1 = string;
export type Runindex = number;
export type Segments = Segment[];
export type Source = number | null;
export type Source1 = number;
export type Segments1 = number;
export type Layout = LayoutLine[];
export type Id1 = string;
export type Pagekey1 = string;
export type Type1 = "text.edit";
export type Paragraphid = string;
export type Id2 = string;
export type Pagekey2 = string;
export type Type2 = "text.ocr_edit";
export type Paragraphid1 = string;
export type Covers = [Rect, ...Rect[]] | null;
export type Covercolor = string;
export type Id3 = string;
export type Pagekey3 = string;
export type Opacity1 = number;
export type Rotation1 = number;
export type Type3 = "image.add";
export type Assetid = string;
export type Id4 = string;
export type Pagekey4 = string;
export type Opacity2 = number;
export type Rotation2 = number;
export type Type4 = "shape.add";
export type Kind2 = "rect" | "ellipse" | "line" | "arrow" | "polygon" | "polyline" | "cloud";
export type Points = [number, number][] | null;
export type Stroke = string;
export type Fill = string | null;
export type Width = number;
export type Dash = "solid" | "dashed" | "dotted";
export type Id5 = string;
export type Pagekey5 = string;
export type Opacity3 = number;
export type Type5 = "ink.add";
/**
 * @minItems 1
 */
export type Paths = [[[number, number], ...[number, number][]], ...[[number, number], ...[number, number][]][]];
export type Color1 = string;
export type Width1 = number;
export type Id6 = string;
export type Pagekey6 = string;
export type Type6 = "whiteout.add";
export type Id7 = string;
export type Pagekey7 = string;
export type Type7 = "redact.add";
export type Fill1 = "black" | "white";
export type Id8 = string;
export type Pagekey8 = string;
export type Opacity4 = number;
export type Rotation3 = number;
export type Type8 = "signature.add";
export type Assetid1 = string;
export type Id9 = string;
export type Pagekey9 = string;
export type Opacity5 = number;
export type Rotation4 = number;
export type Type9 = "stamp.add";
export type Preset =
  | (
      | "approved"
      | "not-approved"
      | "draft"
      | "final"
      | "completed"
      | "confidential"
      | "for-public-release"
      | "not-for-public-release"
      | "for-comment"
      | "void"
      | "preliminary-results"
      | "information-only"
      | "witness"
      | "initial-here"
      | "sign-here"
      | "accepted"
      | "rejected"
      | "disetujui"
      | "tidak-disetujui"
      | "draf"
      | "final-id"
      | "selesai"
      | "rahasia"
      | "untuk-publik"
      | "tidak-untuk-publik"
      | "untuk-dikomentari"
      | "batal"
      | "hasil-sementara"
      | "hanya-informasi"
      | "saksi"
      | "paraf-di-sini"
      | "tanda-tangan-di-sini"
      | "diterima"
      | "ditolak"
    )
  | null;
export type Text2 = string;
export type Date = string | null;
export type Time = string | null;
export type Color2 = string;
export type Id10 = string;
export type Pagekey10 = string;
export type Opacity6 = number;
export type Rotation5 = number;
export type Type10 = "symbol.add";
export type Kind3 = "check" | "cross";
export type Color3 = string;
export type Id11 = string;
export type Pagekey11 = string;
export type Type11 = "link.add";
export type Target = UrlTarget | PageTarget;
export type Url = string;
export type Pagekey12 = string;
export type Id12 = string;
export type Pagekey13 = string;
export type Type12 = "annot.add";
export type Kind4 = "highlight" | "underline" | "strike" | "note";
export type Quads = [Rect, ...Rect[]] | null;
export type Point = [number, number] | null;
export type Color4 = string;
export type Content = string | null;
export type Id13 = string;
export type Type13 = "form.set";
export type Fieldname = string;
export type Value = string | boolean;
export type Doc1 = string | null;
export type Id14 = string;
export type Type14 = "pages.layout";
/**
 * @minItems 1
 * @maxItems 1000
 */
export type Pages = [LayoutPage, ...LayoutPage[]];
export type Pagekey14 = string;
export type Src = DocSrc | BlankSrc;
export type Doc2 = string;
export type Index = number;
export type Width2 = number;
export type Height = number;
export type Rotate = 0 | 90 | 180 | 270;
export type X2 = number;
export type Y1 = number;
export type W1 = number;
export type H1 = number;
/**
 * @maxItems 5000
 */
export type Ops = (
  | TextAdd
  | TextEdit
  | TextOcrEdit
  | ImageAdd
  | ShapeAdd
  | InkAdd
  | WhiteoutAdd
  | RedactAdd
  | SignatureAdd
  | StampAdd
  | SymbolAdd
  | LinkAdd
  | AnnotAdd
  | FormSet
  | PagesLayout
)[];
export type FlattenForms = boolean;
export type Filename = string;
export type ParagraphsVersion = number | null;
export type Pagekey15 = string;
/**
 * @maxItems 5000
 */
export type Ops1 = (
  | TextAdd
  | TextEdit
  | TextOcrEdit
  | ImageAdd
  | ShapeAdd
  | InkAdd
  | WhiteoutAdd
  | RedactAdd
  | SignatureAdd
  | StampAdd
  | SymbolAdd
  | LinkAdd
  | AnnotAdd
  | FormSet
  | PagesLayout
)[];
export type ParagraphsVersion1 = number | null;

export interface EdithSchema {
  export: ExportRequest;
  renderPage: RenderPageRequest;
}
/**
 * This interface was referenced by `EdithSchema`'s JSON-Schema
 * via the `definition` "ExportRequest".
 */
export interface ExportRequest {
  ops: Ops;
  flatten_forms?: FlattenForms;
  filename?: Filename;
  paragraphs_version?: ParagraphsVersion;
}
/**
 * This interface was referenced by `EdithSchema`'s JSON-Schema
 * via the `definition` "TextAdd".
 */
export interface TextAdd {
  id: Id;
  pageKey: Pagekey;
  opacity?: Opacity;
  rotation?: Rotation;
  type: Type;
  box: TextBox;
}
/**
 * This interface was referenced by `EdithSchema`'s JSON-Schema
 * via the `definition` "TextBox".
 */
export interface TextBox {
  rect: Rect;
  align?: Align;
  lineHeight: Lineheight;
  paragraphs: Paragraphs;
  layout: Layout;
}
/**
 * This interface was referenced by `EdithSchema`'s JSON-Schema
 * via the `definition` "Rect".
 */
export interface Rect {
  x: X;
  y: Y;
  w: W;
  h: H;
}
/**
 * `hScale`, `charSpacing`, `wordSpacing`: the original PDF's horizontal scaling (Tz), character spacing (Tc,
 * TJ condensing) and word spacing (Tw, per-word placement), measured by GET /text for original text. The pen
 * advance of a character is `hScale · advance · size + charSpacing (+ wordSpacing for " ")`, in pt; the glyph
 * is drawn `hScale` times as wide. Clients split a run with spacing into one segment per character
 * (`charSpacing`) or per word and space (`wordSpacing`), so a segment's own glyphs only need `hScale`.
 * `underlineTop`, `strikeTop`, `decorThickness` (× size; top edge relative to the baseline, down positive) and
 * `decorColor`: where, how thick and in which colour the original PDF drew a run's underline / strikethrough (GET
 * /text, original text); absent = the defaults of bake/text.py (UNDERLINE_TOP, STRIKE_TOP, DECOR_THICKNESS, the
 * text colour).
 *
 * This interface was referenced by `EdithSchema`'s JSON-Schema
 * via the `definition` "Run".
 */
export interface Run {
  text: Text;
  font: Font;
  size: Size;
  color: Color;
  bgColor?: Bgcolor;
  underline?: Underline;
  strike?: Strike;
  underlineTop?: Underlinetop;
  strikeTop?: Striketop;
  decorThickness?: Decorthickness;
  decorColor?: Decorcolor;
  hScale?: Hscale;
  charSpacing?: Charspacing;
  wordSpacing?: Wordspacing;
}
/**
 * This interface was referenced by `EdithSchema`'s JSON-Schema
 * via the `definition` "BundledFont".
 */
export interface BundledFont {
  kind?: Kind;
  family: Family;
  bold?: Bold;
  italic?: Italic;
}
/**
 * A font embedded in an uploaded PDF (`ref` from GET /documents/{id}/text), reused as is. `doc`: the
 * imported PDF it comes from (xref-based refs are only unique per document); none = the edited PDF.
 *
 * This interface was referenced by `EdithSchema`'s JSON-Schema
 * via the `definition` "OriginalFont".
 */
export interface OriginalFont {
  kind: Kind1;
  ref: Ref;
  doc?: Doc;
}
/**
 * `source` (text.edit only): the index of the original paragraph line this line repeats unchanged (same
 * text, styles and line break, in place). The bake then keeps that line's original glyphs: it neither redacts
 * nor redraws it. If the line no longer matches the original, the bake redraws it from `segments`.
 * `prefix` (text.edit only, M5d): the line is an edited original line whose first words stay as they were. The
 * bake keeps their original glyphs and redraws the rest of the line, from the original x of its first other
 * word on; if the prefix no longer matches the original, it redraws the whole line from `segments`.
 *
 * This interface was referenced by `EdithSchema`'s JSON-Schema
 * via the `definition` "LayoutLine".
 */
export interface LayoutLine {
  baseline: Baseline;
  segments: Segments;
  source?: Source;
  prefix?: LinePrefix | null;
}
/**
 * This interface was referenced by `EdithSchema`'s JSON-Schema
 * via the `definition` "Segment".
 */
export interface Segment {
  x: X1;
  text: Text1;
  runIndex: Runindex;
}
/**
 * The first `segments` segments of a layout line repeat the first words of original line `source` unchanged,
 * in place (see LayoutLine.prefix).
 *
 * This interface was referenced by `EdithSchema`'s JSON-Schema
 * via the `definition` "LinePrefix".
 */
export interface LinePrefix {
  source: Source1;
  segments: Segments1;
}
/**
 * Replaces original paragraph `paragraphId` of the page's source page with `box`.
 *
 * This interface was referenced by `EdithSchema`'s JSON-Schema
 * via the `definition` "TextEdit".
 */
export interface TextEdit {
  id: Id1;
  pageKey: Pagekey1;
  type: Type1;
  paragraphId: Paragraphid;
  box: TextBox;
}
/**
 * Replaces a paragraph OCR read in a picture of text (POST /documents/{id}/pages/{n}/ocr, M5d). `cover` is painted
 * with `coverColor` (the picture's own background there) over the page's original content, under every drawn object
 * — as a text.edit's original glyphs go — and `box` is drawn in the op's stacking order. Self-contained: the bake
 * reads neither the OCR result nor the source page, so a draft restores and exports without OCR running again.
 * `paragraphId` names the OCR paragraph (ocr0, ocr1, …) for the client: one op per page and id. `covers`: one rect per
 * line of the paragraph (its words' ink, padded): what is painted when given, so a short last line leaves the corner
 * beside it alone; `cover` is their bounding box (all that is painted without `covers`).
 *
 * This interface was referenced by `EdithSchema`'s JSON-Schema
 * via the `definition` "TextOcrEdit".
 */
export interface TextOcrEdit {
  id: Id2;
  pageKey: Pagekey2;
  type: Type2;
  paragraphId: Paragraphid1;
  cover: Rect;
  covers?: Covers;
  coverColor: Covercolor;
  box: TextBox;
}
/**
 * This interface was referenced by `EdithSchema`'s JSON-Schema
 * via the `definition` "ImageAdd".
 */
export interface ImageAdd {
  id: Id3;
  pageKey: Pagekey3;
  opacity?: Opacity1;
  rotation?: Rotation1;
  type: Type3;
  rect: Rect;
  assetId: Assetid;
}
/**
 * rect/ellipse use `rect` (and may be rotated); the other kinds use `points` (closed for polygon and
 * cloud; a cloud's border is scalloped, see bake/geometry.py) and keep `rotation` 0.
 *
 * This interface was referenced by `EdithSchema`'s JSON-Schema
 * via the `definition` "ShapeAdd".
 */
export interface ShapeAdd {
  id: Id4;
  pageKey: Pagekey4;
  opacity?: Opacity2;
  rotation?: Rotation2;
  type: Type4;
  kind: Kind2;
  rect?: Rect | null;
  points?: Points;
  stroke: Stroke;
  fill?: Fill;
  width: Width;
  dash?: Dash;
}
/**
 * This interface was referenced by `EdithSchema`'s JSON-Schema
 * via the `definition` "InkAdd".
 */
export interface InkAdd {
  id: Id5;
  pageKey: Pagekey5;
  opacity?: Opacity3;
  type: Type5;
  paths: Paths;
  color: Color1;
  width: Width1;
}
/**
 * This interface was referenced by `EdithSchema`'s JSON-Schema
 * via the `definition` "WhiteoutAdd".
 */
export interface WhiteoutAdd {
  id: Id6;
  pageKey: Pagekey6;
  type: Type6;
  rect: Rect;
}
/**
 * This interface was referenced by `EdithSchema`'s JSON-Schema
 * via the `definition` "RedactAdd".
 */
export interface RedactAdd {
  id: Id7;
  pageKey: Pagekey7;
  type: Type7;
  rect: Rect;
  fill?: Fill1;
}
/**
 * A signature image (drawn, typed or uploaded; always a PNG/JPEG asset).
 *
 * This interface was referenced by `EdithSchema`'s JSON-Schema
 * via the `definition` "SignatureAdd".
 */
export interface SignatureAdd {
  id: Id8;
  pageKey: Pagekey8;
  opacity?: Opacity4;
  rotation?: Rotation3;
  type: Type8;
  rect: Rect;
  assetId: Assetid1;
}
/**
 * This interface was referenced by `EdithSchema`'s JSON-Schema
 * via the `definition` "StampAdd".
 */
export interface StampAdd {
  id: Id9;
  pageKey: Pagekey9;
  opacity?: Opacity5;
  rotation?: Rotation4;
  type: Type9;
  rect: Rect;
  preset?: Preset;
  custom?: StampCustom | null;
  color: Color2;
}
/**
 * This interface was referenced by `EdithSchema`'s JSON-Schema
 * via the `definition` "StampCustom".
 */
export interface StampCustom {
  text: Text2;
  date?: Date;
  time?: Time;
}
/**
 * This interface was referenced by `EdithSchema`'s JSON-Schema
 * via the `definition` "SymbolAdd".
 */
export interface SymbolAdd {
  id: Id10;
  pageKey: Pagekey10;
  opacity?: Opacity6;
  rotation?: Rotation5;
  type: Type10;
  kind: Kind3;
  rect: Rect;
  color: Color3;
}
/**
 * This interface was referenced by `EdithSchema`'s JSON-Schema
 * via the `definition` "LinkAdd".
 */
export interface LinkAdd {
  id: Id11;
  pageKey: Pagekey11;
  type: Type11;
  rect: Rect;
  target: Target;
}
/**
 * This interface was referenced by `EdithSchema`'s JSON-Schema
 * via the `definition` "UrlTarget".
 */
export interface UrlTarget {
  url: Url;
}
/**
 * This interface was referenced by `EdithSchema`'s JSON-Schema
 * via the `definition` "PageTarget".
 */
export interface PageTarget {
  pageKey: Pagekey12;
}
/**
 * A native PDF annotation: text markup over `quads` (one rect per line, horizontal text) or a
 * sticky note whose icon's top-left corner is `point`.
 *
 * This interface was referenced by `EdithSchema`'s JSON-Schema
 * via the `definition` "AnnotAdd".
 */
export interface AnnotAdd {
  id: Id12;
  pageKey: Pagekey13;
  type: Type12;
  kind: Kind4;
  quads?: Quads;
  point?: Point;
  color: Color4;
  content?: Content;
}
/**
 * Value of AcroForm field `fieldName` (every widget of that name): text/combo/list -> the string,
 * checkbox -> bool, radio -> the on-state name of the chosen button (or "Off"). `doc`: a field of that
 * imported PDF, named as in its own structure (the export may rename it when the name is taken); none =
 * the edited PDF.
 *
 * This interface was referenced by `EdithSchema`'s JSON-Schema
 * via the `definition` "FormSet".
 */
export interface FormSet {
  id: Id13;
  type: Type13;
  fieldName: Fieldname;
  value: Value;
  doc?: Doc1;
}
/**
 * This interface was referenced by `EdithSchema`'s JSON-Schema
 * via the `definition` "PagesLayout".
 */
export interface PagesLayout {
  id: Id14;
  type: Type14;
  pages: Pages;
}
/**
 * `src.doc` is the edited document or another uploaded one (an imported PDF).
 *
 * This interface was referenced by `EdithSchema`'s JSON-Schema
 * via the `definition` "LayoutPage".
 */
export interface LayoutPage {
  pageKey: Pagekey14;
  src: Src;
  rotate?: Rotate;
  crop?: CropRect | null;
}
/**
 * This interface was referenced by `EdithSchema`'s JSON-Schema
 * via the `definition` "DocSrc".
 */
export interface DocSrc {
  doc: Doc2;
  index: Index;
}
/**
 * This interface was referenced by `EdithSchema`'s JSON-Schema
 * via the `definition` "BlankSrc".
 */
export interface BlankSrc {
  blank: BlankSize;
}
/**
 * This interface was referenced by `EdithSchema`'s JSON-Schema
 * via the `definition` "BlankSize".
 */
export interface BlankSize {
  width: Width2;
  height: Height;
}
/**
 * Visible part of a page, in the page's own coordinates (unrotated, relative to its source CropBox).
 *
 * This interface was referenced by `EdithSchema`'s JSON-Schema
 * via the `definition` "CropRect".
 */
export interface CropRect {
  x: X2;
  y: Y1;
  w: W1;
  h: H1;
}
/**
 * This interface was referenced by `EdithSchema`'s JSON-Schema
 * via the `definition` "RenderPageRequest".
 */
export interface RenderPageRequest {
  pageKey: Pagekey15;
  ops: Ops1;
  paragraphs_version?: ParagraphsVersion1;
}
