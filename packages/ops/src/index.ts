export * from "./types";
import type { AnnotAdd, ExportRequest, Run, StampAdd } from "./types";

/** Any op accepted by the API. */
export type Op = ExportRequest["ops"][number];
/** Ops drawn on (or attached to) one page; `form.set` is document-wide and `pages.layout` is the page list. */
export type ContentOp = Exclude<Op, { type: "pages.layout" } | { type: "form.set" }>;
/** A run's font: a bundled family or a font embedded in the uploaded PDF. */
export type FontRef = Run["font"];
export type StampPreset = NonNullable<StampAdd["preset"]>;
export type AnnotKind = AnnotAdd["kind"];
