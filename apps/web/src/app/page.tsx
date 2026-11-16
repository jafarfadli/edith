import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { Arrow, Ring } from "@/components/bench/Marks";
import { Cutter, Pencil } from "@/components/bench/Props";
import { RecentEdits } from "@/components/RecentEdits";
import { UploadDropzone } from "@/components/UploadDropzone";
import { ToolsGrid } from "@/components/tools/ToolsGrid";
import { t } from "@/lib/strings";

/** The start page is the bench: a blank sheet clipped down, waiting for the PDF, with the tools lying around it and a
 *  few pencil marks; below it the tray of single-purpose PDF tools. */
export default function Home() {
  const { facts } = t.upload;
  return (
    <div className="relative flex min-h-dvh flex-col overflow-x-clip bg-base">
      <div aria-hidden className="bench-grid bench-fade pointer-events-none absolute inset-x-0 top-0 h-[52rem]" />
      <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-5 pt-6 md:px-10">
        <Link href="/" aria-label={t.appName} className="rounded-md"><Logo /></Link>
        <a href="#alat" className="rounded-md px-2 py-1 text-sm text-muted transition-colors hover:text-ink">{t.tools.heading}</a>
      </header>

      <main className="relative z-10 mx-auto grid w-full max-w-6xl flex-1 items-center gap-16 px-5 pb-24 pt-14 md:grid-cols-[minmax(0,1fr)_minmax(0,23rem)] md:gap-10 md:px-10 md:pt-10 lg:gap-24">
        <section className="flex min-w-0 flex-col gap-9">
          <h1 className="font-wide text-[clamp(2.3rem,5.4vw,4.6rem)] font-extrabold leading-[0.95] tracking-[-0.035em] text-ink">
            {t.upload.title}
            <span className="block font-medium text-muted [font-variation-settings:'wdth'_96]">{t.upload.titleAfter}</span>
          </h1>
          <ul className="flex flex-wrap items-center gap-x-8 gap-y-3 text-base text-ink">
            <li className="relative px-1">
              {facts.free}
              <Ring delay={900} className="pointer-events-none absolute -left-3 -top-2.5 h-[calc(100%+1.25rem)] w-[calc(100%+1.5rem)]" />
            </li>
            <li>{facts.signup}</li>
            <li>{facts.gone}</li>
          </ul>
          <RecentEdits />
        </section>

        <div className="relative w-full max-w-[17rem] justify-self-center md:max-w-[23rem] md:justify-self-end">
          <Arrow delay={1100} className="pointer-events-none absolute -left-48 top-[calc(56%-5.5rem)] hidden w-44 -scale-y-100 lg:block" />
          <UploadDropzone />
          <Cutter className="animate-slide-in pointer-events-none absolute -bottom-8 -right-14 w-52 rotate-[-30deg] md:-right-32 md:w-72" />
          <Pencil className="animate-slide-in pointer-events-none absolute -bottom-14 -left-36 hidden w-56 rotate-[-5deg] [animation-delay:.3s] md:block" />
        </div>
      </main>

      <ToolsGrid />
    </div>
  );
}
