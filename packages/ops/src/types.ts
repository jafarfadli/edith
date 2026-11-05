/* Generated from apps/api/edith/ops.py — do not edit. Run: npm run gen -w packages/ops */

export type Id = string;
export type Pagekey = string;
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
export type Size = number;
export type Color = string;
export type Bgcolor = string | null;
export type Underline = boolean;
export type Strike = boolean;
export type Paragraphs = Run[][];
export type Baseline = number;
export type X1 = number;
export type Text1 = string;
export type Runindex = number;
export type Segments = Segment[];
export type Layout = LayoutLine[];
export type Id1 = string;
export type Pagekey1 = string;
export type Type1 = "text.edit";
export type Paragraphid = string;
export type Id2 = string;
export type Pagekey2 = string;
export type Type2 = "image.add";
export type Assetid = string;
export type Id3 = string;
export type Pagekey3 = string;
export type Type3 = "shape.add";
export type Kind2 = "rect" | "ellipse" | "line" | "arrow";
export type Points = [number, number][] | null;
export type Stroke = string;
export type Fill = string | null;
export type Width = number;
export type Id4 = string;
export type Pagekey4 = string;
export type Type4 = "ink.add";
/**
 * @minItems 1
 */
export type Paths = [[[number, number], ...[number, number][]], ...[[number, number], ...[number, number][]][]];
export type Color1 = string;
export type Width1 = number;
export type Id5 = string;
export type Pagekey5 = string;
export type Type5 = "whiteout.add";
export type Id6 = string;
export type Pagekey6 = string;
export type Type6 = "redact.add";
export type Fill1 = "black" | "white";
export type Id7 = string;
export type Type7 = "pages.layout";
/**
 * @minItems 1
 * @maxItems 1000
 */
export type Pages = [LayoutPage, ...LayoutPage[]];
export type Pagekey7 = string;
export type Src = DocSrc | BlankSrc;
export type Doc = string;
export type Index = number;
export type Width2 = number;
export type Height = number;
export type Rotate = 0 | 90 | 180 | 270;
/**
 * @maxItems 5000
 */
export type Ops = (TextAdd | TextEdit | ImageAdd | ShapeAdd | InkAdd | WhiteoutAdd | RedactAdd | PagesLayout)[];
export type FlattenForms = boolean;
export type Filename = string;
export type Pagekey8 = string;
/**
 * @maxItems 5000
 */
export type Ops1 = (TextAdd | TextEdit | ImageAdd | ShapeAdd | InkAdd | WhiteoutAdd | RedactAdd | PagesLayout)[];

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
}
/**
 * This interface was referenced by `EdithSchema`'s JSON-Schema
 * via the `definition` "TextAdd".
 */
export interface TextAdd {
  id: Id;
  pageKey: Pagekey;
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
 * A font embedded in the uploaded PDF (`ref` from GET /documents/{id}/text), reused as is.
 *
 * This interface was referenced by `EdithSchema`'s JSON-Schema
 * via the `definition` "OriginalFont".
 */
export interface OriginalFont {
  kind: Kind1;
  ref: Ref;
}
/**
 * This interface was referenced by `EdithSchema`'s JSON-Schema
 * via the `definition` "LayoutLine".
 */
export interface LayoutLine {
  baseline: Baseline;
  segments: Segments;
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
 * This interface was referenced by `EdithSchema`'s JSON-Schema
 * via the `definition` "ImageAdd".
 */
export interface ImageAdd {
  id: Id2;
  pageKey: Pagekey2;
  type: Type2;
  rect: Rect;
  assetId: Assetid;
}
/**
 * This interface was referenced by `EdithSchema`'s JSON-Schema
 * via the `definition` "ShapeAdd".
 */
export interface ShapeAdd {
  id: Id3;
  pageKey: Pagekey3;
  type: Type3;
  kind: Kind2;
  rect?: Rect | null;
  points?: Points;
  stroke: Stroke;
  fill?: Fill;
  width: Width;
}
/**
 * This interface was referenced by `EdithSchema`'s JSON-Schema
 * via the `definition` "InkAdd".
 */
export interface InkAdd {
  id: Id4;
  pageKey: Pagekey4;
  type: Type4;
  paths: Paths;
  color: Color1;
  width: Width1;
}
/**
 * This interface was referenced by `EdithSchema`'s JSON-Schema
 * via the `definition` "WhiteoutAdd".
 */
export interface WhiteoutAdd {
  id: Id5;
  pageKey: Pagekey5;
  type: Type5;
  rect: Rect;
}
/**
 * This interface was referenced by `EdithSchema`'s JSON-Schema
 * via the `definition` "RedactAdd".
 */
export interface RedactAdd {
  id: Id6;
  pageKey: Pagekey6;
  type: Type6;
  rect: Rect;
  fill?: Fill1;
}
/**
 * This interface was referenced by `EdithSchema`'s JSON-Schema
 * via the `definition` "PagesLayout".
 */
export interface PagesLayout {
  id: Id7;
  type: Type7;
  pages: Pages;
}
/**
 * This interface was referenced by `EdithSchema`'s JSON-Schema
 * via the `definition` "LayoutPage".
 */
export interface LayoutPage {
  pageKey: Pagekey7;
  src: Src;
  rotate?: Rotate;
}
/**
 * This interface was referenced by `EdithSchema`'s JSON-Schema
 * via the `definition` "DocSrc".
 */
export interface DocSrc {
  doc: Doc;
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
 * This interface was referenced by `EdithSchema`'s JSON-Schema
 * via the `definition` "RenderPageRequest".
 */
export interface RenderPageRequest {
  pageKey: Pagekey8;
  ops: Ops1;
}
