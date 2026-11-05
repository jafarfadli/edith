export * from "./types";
import type { ExportRequest } from "./types";

/** Any op accepted by the API. */
export type Op = ExportRequest["ops"][number];
export type ContentOp = Exclude<Op, { type: "pages.layout" }>;
