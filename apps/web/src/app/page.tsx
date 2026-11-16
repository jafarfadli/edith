import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { Cutter, Pencil } from "@/components/bench/Props";
import { Crumbs, Headline } from "@/components/hero/Headline";
import { Stickers } from "@/components/hero/Stickers";
import { RecentEdits } from "@/components/RecentEdits";
import { UploadDropzone } from "@/components/UploadDropzone";
import { ToolsGrid } from "@/components/tools/ToolsGrid";
import { t } from "@/lib/strings";

/** Where each piece of the hero goes. A phone or tablet stacks them: the headline, the sheet right after it (so
 *  uploading stays near the top), then the stickers. From 1024px the headline fills the left two thirds, the sheet the
 *  right third, and the stickers spread out under the headline:
 *    EDIT PDF  | sheet
 *    stickers  | sheet        */
const AREAS = "[grid-template-areas:'words'_'sheet'_'stickers'] lg:[grid-template-areas:'words_sheet'_'stickers_sheet']";

/** The start page is the bench: a blank sheet clipped down, waiting for the PDF, with the headline and the tools lying
 *  around it; below it the tray of single-purpose PDF tools. */
export default function Home() {
  return (
    <div className="relative flex min-h-dvh flex-col overflow-x-clip bg-base">
      <div aria-hidden className="bench-grid bench-fade pointer-events-none absolute inset-x-0 top-0 h-[60rem]" />
      <Crumbs className="absolute inset-x-0 top-0 h-[56rem]" />
      <header className="relative z-20 mx-auto flex w-full max-w-[84rem] items-center justify-between px-5 pt-6 md:px-10">
        <Link href="/" aria-label={t.appName} className="rounded-md"><Logo /></Link>
        <a href="#tools" className="rounded-md px-2 py-1 text-sm text-muted transition-colors hover:text-ink">{t.tools.heading}</a>
      </header>

      <main className={`relative z-10 mx-auto grid w-full max-w-[84rem] content-center gap-x-12 gap-y-12 px-5 pb-24 pt-10 md:px-10 lg:min-h-[calc(100dvh-4.5rem)] lg:grid-cols-[auto_clamp(17rem,26vw,23rem)] lg:justify-center lg:gap-x-[clamp(4rem,8vw,9rem)] lg:gap-y-10 lg:pb-20 lg:pt-4 ${AREAS}`}>
        {/* From 1024px as wide as the screen's height allows, so the stickers under it stay in view. */}
        <Headline className="w-full max-w-[26rem] [grid-area:words] md:max-w-[36rem] lg:w-[min(42rem,calc((100dvh-17rem)*1.1),calc(66vw-6rem))] lg:max-w-none lg:self-end" />

        <div className="relative w-full max-w-[17rem] justify-self-center [grid-area:sheet] md:max-w-[21rem] lg:max-w-none lg:self-center">
          <UploadDropzone />
          {/* The pencil rests across the sheet's bottom-left corner, the cutter across its bottom-right, as if just put down. */}
          <Pencil className="animate-slide-in pointer-events-none absolute -bottom-7 -left-24 z-10 hidden w-56 rotate-[-16deg] [animation-delay:.3s] md:block" />
          <Cutter className="animate-slide-in pointer-events-none absolute -bottom-10 -right-14 z-10 w-52 rotate-[-24deg] md:-right-24 md:w-64" />
        </div>

        <section className="flex min-w-0 flex-col gap-10 [grid-area:stickers] lg:self-start">
          <Stickers className="max-w-[44rem] lg:max-w-[min(42rem,calc((100dvh-17rem)*1.1),calc(66vw-6rem))]" />
          <RecentEdits />
        </section>
      </main>

      <ToolsGrid />
    </div>
  );
}
