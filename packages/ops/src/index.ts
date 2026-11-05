export * from "./types";
import type { ExportRequest, Run } from "./types";

/** Any op accepted by the API. */
export type Op = ExportRequest["ops"][number];
export type ContentOp = Exclude<Op, { type: "pages.layout" }>;
/** A run's font: a bundled family or a font embedded in the uploaded PDF. */
export type FontRef = Run["font"];
