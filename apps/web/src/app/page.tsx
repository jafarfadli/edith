import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { Cutter, Pencil } from "@/components/bench/Props";
import { Crumbs, Headline } from "@/components/hero/Headline";
import { Stickers } from "@/components/hero/Stickers";
import { RecentEdits } from "@/components/RecentEdits";
import { UploadDropzone } from "@/components/UploadDropzone";
import { ToolsGrid } from "@/components/tools/ToolsGrid";
import { t } from "@/lib/strings";

/** The start page is the bench: a blank sheet clipped down, waiting for the PDF, with the tools lying around it and a
 *  few pencil marks; below it the tray of single-purpose PDF tools. */
export default function Home() {
  return (
    <div className="relative flex min-h-dvh flex-col overflow-x-clip bg-base">
      <div aria-hidden className="bench-grid bench-fade pointer-events-none absolute inset-x-0 top-0 h-[52rem]" />
      <Crumbs className="absolute inset-x-0 top-0 h-[48rem]" />
      <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-5 pt-6 md:px-10">
        <Link href="/" aria-label={t.appName} className="rounded-md"><Logo /></Link>
        <a href="#tools" className="rounded-md px-2 py-1 text-sm text-muted transition-colors hover:text-ink">{t.tools.heading}</a>
      </header>

      {/* On a phone the sheet comes right after the headline, so uploading stays near the top; beside it from md. */}
      <main className="relative z-10 mx-auto grid w-full max-w-6xl flex-1 content-center gap-x-10 gap-y-14 px-5 pb-24 pt-12 md:grid-cols-[minmax(0,1fr)_minmax(0,23rem)] md:gap-y-12 md:px-10 md:pt-10 lg:gap-x-24">
        <div className="min-w-0 md:self-end"><Headline /></div>

        <div className="relative w-full max-w-[17rem] justify-self-center md:col-start-2 md:row-span-2 md:row-start-1 md:max-w-[23rem] md:self-center md:justify-self-end">
          <UploadDropzone />
          <Cutter className="animate-slide-in pointer-events-none absolute -bottom-8 -right-14 w-52 rotate-[-30deg] md:-right-32 md:w-72" />
          <Pencil className="animate-slide-in pointer-events-none absolute -bottom-14 -left-36 hidden w-56 rotate-[-5deg] [animation-delay:.3s] md:block" />
        </div>

        <section className="flex min-w-0 flex-col gap-10 md:self-start">
          <Stickers />
          <RecentEdits />
        </section>
      </main>

      <ToolsGrid />
    </div>
  );
}
