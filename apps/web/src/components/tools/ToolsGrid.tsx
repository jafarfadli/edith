import Link from "next/link";
import { t } from "@/lib/strings";
import { TOOL_GROUPS, TOOL_ICONS } from "./icons";

/** The start page's tray of PDF tools, grouped by what they do, on a shelf with a ruler edge. */
export function ToolsGrid() {
  return (
    <section id="tools" aria-labelledby="tools-heading" data-testid="tools-grid" className="relative z-10 scroll-mt-4 border-t border-line bg-panel">
      <div aria-hidden className="ruler-edge h-3.5 border-b border-line/60" />
      <div className="mx-auto w-full max-w-6xl px-5 pb-20 pt-12 md:px-10">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h2 id="tools-heading" className="font-wide text-2xl font-bold tracking-tight text-ink">{t.tools.heading}</h2>
        </div>
        <div className="mt-10 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-[1fr_1.25fr_1fr_0.8fr]">
          {TOOL_GROUPS.map((group) => (
            <div key={group.name}>
              <h3 className="font-condensed text-xs font-semibold uppercase tracking-[0.14em] text-faint">{t.tools.groups[group.name]}</h3>
              <ul className="mt-3 grid grid-cols-2 gap-x-4 sm:flex sm:flex-col">
                {group.tools.map((slug) => {
                  const Icon = TOOL_ICONS[slug];
                  const item = t.tools.items[slug];
                  return (
                    <li key={slug}>
                      <Link href={`/tools/${slug}`} title={item.desc}
                        className="group -mx-2 flex items-center gap-3 rounded-md px-2 py-2 text-[0.9375rem] text-ink transition-colors hover:bg-hover">
                        <Icon size={20} className="shrink-0 text-muted transition-[color,translate] duration-200 ease-out-expo group-hover:-translate-y-px group-hover:text-accent-text" />
                        <span className="bg-[linear-gradient(var(--accent),var(--accent))] bg-[length:0%_1.5px] bg-left-bottom bg-no-repeat pb-px transition-[background-size] duration-300 ease-out-expo group-hover:bg-[length:100%_1.5px]">{item.name}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
