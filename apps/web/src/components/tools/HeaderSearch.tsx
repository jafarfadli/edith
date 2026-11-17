"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { t } from "@/lib/strings";
import { TOOLS } from "@/lib/tools";
import { searchTools, wantsEditor } from "@/lib/toolSearch";
import { SearchIcon } from "../brand/icons";
import { TOOL_ICONS } from "./icons";

const ALL = TOOLS.map((x) => x.slug);

/** The start page's search, in the header so it is the first thing seen: what people need in their own words
 *  ("kecilkan", "fotokopi KTP", "skripsi") gives the matching tools under it, best first, and edits of the PDF itself
 *  (signing, editing text) point to the editor's upload. "/" jumps to it; arrows and Enter pick; Esc clears. */
export function HeaderSearch({ className = "" }: { className?: string }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const searching = open && query.trim().length > 0;
  const found = searching ? searchTools(query, ALL) : [];
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

  const upload = () => {
    setOpen(false);
    document.getElementById("upload-pdf")?.click();
  };

  return (
    <div className={`relative ${className}`}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false); }}>
      <label className="flex h-10 w-full items-center gap-2 rounded-lg bg-raised/80 px-3 shadow-sm ring-1 ring-inset ring-line-strong backdrop-blur-sm focus-within:ring-2 focus-within:ring-accent">
        <SearchIcon size={16} className="shrink-0 text-muted" aria-hidden />
        <input ref={input} type="search" value={query} data-testid="tool-search"
          role="combobox" aria-expanded={searching} aria-controls="tool-results" aria-autocomplete="list"
          aria-activedescendant={searching && found[at] ? `tool-result-${found[at]}` : undefined}
          aria-label={t.tools.search.label} placeholder={t.tools.search.placeholder}
          onFocus={() => setOpen(true)}
          onChange={(e) => { setQuery(e.target.value); setAt(0); setOpen(true); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setAt((i) => Math.min(found.length - 1, i + 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setAt((i) => Math.max(0, i - 1)); }
            else if (e.key === "Enter") {
              e.preventDefault();
              if (found[at]) router.push(`/tools/${found[at]}`);
              else if (editor) upload();
            } else if (e.key === "Escape") { setQuery(""); setOpen(false); }
          }}
          className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-faint [&::-webkit-search-cancel-button]:hidden" />
        <kbd aria-hidden className="hidden rounded-sm bg-hover px-1.5 text-xs text-muted sm:inline">/</kbd>
      </label>

      {searching && (
        <div id="tool-results" data-testid="tool-results"
          className="absolute inset-x-0 top-full z-30 mt-2 flex max-h-[min(28rem,70vh)] flex-col overflow-y-auto rounded-lg bg-raised p-1.5 shadow-modal ring-1 ring-line sm:-inset-x-6">
          {editor && (
            <div className="m-1 flex flex-col gap-2 rounded-md bg-accent/10 px-3 py-2.5 text-sm text-ink ring-1 ring-inset ring-accent/30">
              <p>{t.tools.search.editor}</p>
              <button type="button" onClick={upload} className="w-fit text-sm font-medium text-accent-text underline underline-offset-2">
                {t.tools.search.editorLink}
              </button>
            </div>
          )}
          {found.length > 0 ? (
            <ul role="listbox" aria-label={t.tools.search.label}>
              {found.map((slug, i) => {
                const Icon = TOOL_ICONS[slug];
                const item = t.tools.items[slug];
                return (
                  <li key={slug} role="presentation">
                    <Link id={`tool-result-${slug}`} role="option" aria-selected={i === at} href={`/tools/${slug}`} tabIndex={-1}
                      onPointerMove={() => setAt(i)}
                      className={`flex items-center gap-3 rounded-md px-2.5 py-2 ${i === at ? "bg-hover" : ""}`}>
                      <Icon size={20} className={`shrink-0 ${i === at ? "text-accent-text" : "text-muted"}`} aria-hidden />
                      <span className="flex min-w-0 flex-col">
                        <span className="text-sm text-ink">{item.name}</span>
                        <span className="truncate text-xs text-muted">{item.desc}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : !editor && <p className="px-3 py-4 text-center text-sm text-muted">{t.tools.search.none}</p>}
        </div>
      )}
    </div>
  );
}
