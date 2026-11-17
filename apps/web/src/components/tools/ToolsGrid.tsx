import { RecentEdits } from "@/components/RecentEdits";
import { ToolsBrowser } from "./ToolsBrowser";

/** The start page's tray, on a shelf with a ruler edge: the edits this browser kept (when there are any), then the PDF
 *  tools, grouped by what they do. */
export function ToolsGrid() {
  return (
    <section id="tools" aria-labelledby="tools-heading" data-testid="tools-grid" className="relative z-10 scroll-mt-4 border-t border-line bg-panel">
      <div aria-hidden className="ruler-edge h-3.5 border-b border-line/60" />
      <div className="mx-auto w-full max-w-6xl px-5 pb-20 pt-12 md:px-10">
        <RecentEdits className="mb-14 border-b border-line pb-12" />
        <ToolsBrowser />
      </div>
    </section>
  );
}
