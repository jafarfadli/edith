import { createStore } from "zustand/vanilla";
import type { ExportOutput } from "@edith/ops";

/** The editor's "Unduh" beyond the plain PDF: the options dialog (open with `pages` filled in, e.g. from a page's
 *  menu), and a download asked from elsewhere (`request`, taken by the Header that runs it). */
export const downloadStore = createStore<{
  dialog: { pages: string } | null;
  /** The file name typed in the top bar (null: the document's own), shown in the dialog's summary. */
  fileName: string | null;
  request: ExportOutput | null;
  open(pages?: string): void;
  close(): void;
  ask(output: ExportOutput): void;
  take(): ExportOutput | null;
}>()((set, get) => ({
  dialog: null,
  fileName: null,
  request: null,
  open: (pages = "") => set({ dialog: { pages } }),
  close: () => set({ dialog: null }),
  ask: (output) => set({ request: output, dialog: null }),
  take: () => { const r = get().request; if (r) set({ request: null }); return r; },
}));
