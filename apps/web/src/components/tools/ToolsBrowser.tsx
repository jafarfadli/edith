import Link from "next/link";
import { t } from "@/lib/strings";
import type { ToolSlug } from "@/lib/tools";
import { TOOL_GROUPS, TOOL_ICONS } from "./icons";

/** The tools by group (the search over them is in the page's header). */
export function ToolsBrowser() {
  const link = (slug: ToolSlug) => {
    const Icon = TOOL_ICONS[slug];
    const item = t.tools.items[slug];
    return (
      <Link href={`/tools/${slug}`} title={item.desc}
        className="group -mx-2 flex items-center gap-3 rounded-md px-2 py-2 text-[0.9375rem] text-ink transition-colors hover:bg-hover">
        <Icon size={20} className="shrink-0 text-muted transition-[color,translate] duration-200 ease-out-expo group-hover:-translate-y-px group-hover:text-accent-text" />
        <span className="w-fit bg-[linear-gradient(var(--accent),var(--accent))] bg-[length:0%_1.5px] bg-left-bottom bg-no-repeat pb-px transition-[background-size] duration-300 ease-out-expo group-hover:bg-[length:100%_1.5px]">{item.name}</span>
      </Link>
    );
  };

  return (
    <>
      <h2 id="tools-heading" className="font-wide text-2xl font-bold tracking-tight text-ink">{t.tools.heading}</h2>
      <div className="mt-10 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-[1fr_1.25fr_1fr_1fr_0.8fr]">
        {TOOL_GROUPS.map((group) => (
          <div key={group.name}>
            <h3 className="font-condensed text-xs font-semibold uppercase tracking-[0.14em] text-faint">{t.tools.groups[group.name]}</h3>
            <ul className="mt-3 grid grid-cols-2 gap-x-4 sm:flex sm:flex-col">
              {group.tools.map((slug) => <li key={slug}>{link(slug)}</li>)}
            </ul>
          </div>
        ))}
      </div>
    </>
  );
}
