import { FormInput, LayoutGrid, Signature, Type } from "lucide-react";
import { UploadDropzone } from "@/components/UploadDropzone";
import { t } from "@/lib/strings";

const POINTS = [
  { icon: Type, text: t.upload.points.text },
  { icon: FormInput, text: t.upload.points.forms },
  { icon: Signature, text: t.upload.points.sign },
  { icon: LayoutGrid, text: t.upload.points.pages },
];

/** The start page is the editor's empty canvas: the pitch on the left, a blank page to drop the PDF on at the right. */
export default function Home() {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="flex h-12 shrink-0 items-center border-b border-line bg-panel px-4">
        <span className="flex items-center gap-2 font-semibold tracking-tight text-ink">
          <span aria-hidden className="h-2.5 w-2.5 rounded-[3px] bg-accent" />
          {t.appName}
        </span>
      </header>
      <main className="mx-auto grid w-full max-w-5xl flex-1 items-center gap-12 px-4 py-12 md:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] md:gap-16 md:px-8">
        <section className="flex min-w-0 flex-col gap-6">
          <h1 className="text-4xl font-semibold tracking-tight text-ink [overflow-wrap:anywhere] sm:text-5xl">{t.upload.title}</h1>
          <p className="max-w-md text-base text-muted">{t.upload.lede}</p>
          <ul className="flex flex-col gap-3">
            {POINTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-sm text-ink">
                <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-panel text-accent-text ring-1 ring-inset ring-line">
                  <Icon size={16} strokeWidth={1.75} />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </section>
        <div className="flex justify-center md:justify-end">
          <UploadDropzone />
        </div>
      </main>
    </div>
  );
}
