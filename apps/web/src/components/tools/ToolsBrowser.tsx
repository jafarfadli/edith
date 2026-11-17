"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { t } from "@/lib/strings";
import { TOOLS } from "@/lib/tools";
import { searchTools, wantsEditor } from "@/lib/toolSearch";
import { SearchIcon } from "../brand/icons";
import { TOOL_GROUPS, TOOL_ICONS } from "./icons";

const ALL = TOOLS.map((x) => x.slug);

/** The tools by group, and a search over them that understands what people need ("kecilkan", "fotokopi KTP",
 *  "skripsi"): it lists the matching tools, best first, and points edits of the PDF itself (signing, editing text) to
 *  the editor. "/" jumps to it. */
export function ToolsBrowser() {
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const found = searchTools(query, ALL);
  const searching = query.trim().length > 0;
  const editor = searching && wantsEditor(query);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key !== "/" || e.metaKey || e.ctrlKey || ["INPUT", "TEXTAREA"].includes(el?.tagName ?? "") || el?.isContentEditable) return;
      e.preventDefault();
      input.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const link = (slug: (typeof ALL)[number], big = false) => {
    const Icon = TOOL_ICONS[slug];
    const item = t.tools.items[slug];
    return (
      <Link href={`/tools/${slug}`} title={item.desc}
        className="group -mx-2 flex items-center gap-3 rounded-md px-2 py-2 text-[0.9375rem] text-ink transition-colors hover:bg-hover">
        <Icon size={20} className="shrink-0 text-muted transition-[color,translate] duration-200 ease-out-expo group-hover:-translate-y-px group-hover:text-accent-text" />
        <span className="flex min-w-0 flex-col">
          <span className="w-fit bg-[linear-gradient(var(--accent),var(--accent))] bg-[length:0%_1.5px] bg-left-bottom bg-no-repeat pb-px transition-[background-size] duration-300 ease-out-expo group-hover:bg-[length:100%_1.5px]">{item.name}</span>
          {big && <span className="text-xs text-muted">{item.desc}</span>}
        </span>
      </Link>
    );
  };

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
        <h2 id="tools-heading" className="font-wide text-2xl font-bold tracking-tight text-ink">{t.tools.heading}</h2>
        <label className="flex h-10 w-full items-center gap-2 rounded-lg bg-base/60 px-3 ring-1 ring-inset ring-line-strong focus-within:ring-2 focus-within:ring-accent sm:w-80">
          <SearchIcon size={16} className="shrink-0 text-muted" aria-hidden />
          <input ref={input} type="search" value={query} onChange={(e) => setQuery(e.target.value)} data-testid="tool-search"
            aria-label={t.tools.search.label} placeholder={t.tools.search.placeholder}
            onKeyDown={(e) => { if (e.key === "Escape") setQuery(""); }}
            className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-faint" />
          <kbd aria-hidden className="hidden rounded-sm bg-hover px-1.5 text-xs text-muted sm:inline">/</kbd>
        </label>
      </div>
      {searching ? (
        <div className="mt-8 flex flex-col gap-4" data-testid="tool-results">
          {editor && (
            <p className="rounded-lg bg-accent/10 px-4 py-3 text-sm text-ink ring-1 ring-inset ring-accent/30">
              {t.tools.search.editor}{" "}
              <a href="#top" className="font-medium text-accent-text underline underline-offset-2">{t.tools.search.editorLink}</a>
            </p>
          )}
          {found.length ? (
            <ul className="grid gap-x-10 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
              {found.map((slug) => <li key={slug}>{link(slug, true)}</li>)}
            </ul>
          ) : !editor && <p className="text-sm text-muted">{t.tools.search.none}</p>}
        </div>
      ) : (
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
      )}
    </>
  );
}
