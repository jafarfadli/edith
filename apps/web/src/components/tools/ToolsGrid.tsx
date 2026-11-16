import Link from "next/link";
import { TOOLS } from "@/lib/tools";
import { t } from "@/lib/strings";
import { TOOL_ICONS } from "./icons";

/** The start page's "Alat PDF": one card per tool, to its page. */
export function ToolsGrid() {
  return (
    <section aria-labelledby="tools-heading" className="mx-auto w-full max-w-5xl px-4 pb-16 md:px-8" data-testid="tools-grid">
      <h2 id="tools-heading" className="text-lg font-semibold tracking-tight text-ink">{t.tools.heading}</h2>
      <p className="mt-1 text-sm text-muted">{t.tools.lede}</p>
      <ul className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {TOOLS.map(({ slug }) => {
          const Icon = TOOL_ICONS[slug];
          const item = t.tools.items[slug];
          return (
            <li key={slug}>
              <Link href={`/tools/${slug}`}
                className="flex h-full items-start gap-3 rounded-lg bg-panel p-4 ring-1 ring-inset ring-line transition-colors hover:bg-hover hover:ring-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
                <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-accent/10 text-accent-text">
                  <Icon size={18} strokeWidth={1.75} />
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm font-medium text-ink">{item.name}</span>
                  <span className="text-xs text-muted">{item.desc}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
