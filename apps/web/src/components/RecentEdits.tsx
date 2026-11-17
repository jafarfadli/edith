"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ago, forget, listed, parseIndex, rawIndex, subscribeIndex, tidy } from "@/lib/library";
import { t } from "@/lib/strings";
import { CloseIcon, SheetIcon } from "./brand/icons";

/** The edits this browser kept, newest first: opening one continues it (with its changes); uploading a file always
 *  starts a clean edit. Shown on the start page's tray, above the PDF tools, only when there are any. */
export function RecentEdits({ className }: { className?: string }) {
  const raw = useSyncExternalStore(subscribeIndex, rawIndex, () => "[]"); // (nothing is listed on the server)
  const items = useMemo(() => listed(parseIndex(raw)), [raw]);
  const [now] = useState(() => Date.now());

  useEffect(() => { void tidy(); }, []);

  if (!items.length) return null;
  return (
    <section aria-labelledby="recent-title" data-testid="recent-edits" className={`flex w-full flex-col gap-5 ${className ?? ""}`}>
      <h2 id="recent-title" className="font-wide text-2xl font-bold tracking-tight text-ink">{t.upload.recent}</h2>
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((r) => (
          <li key={r.id} className="group flex items-center gap-1 rounded-md bg-base/50 ring-1 ring-inset ring-line transition-colors hover:bg-raised">
            <Link href={`/edit/${r.id}?name=${encodeURIComponent(r.name)}`} className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2">
              <SheetIcon size={18} className="shrink-0 text-muted transition-colors group-hover:text-accent-text" />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm text-ink">{r.name}</span>
                <span className="font-mono text-2xs text-faint">{ago(r.updatedAt, now)} · {t.upload.recentPages(r.pageCount)}</span>
              </span>
            </Link>
            <button type="button" aria-label={`${t.upload.recentRemove}: ${r.name}`} title={t.upload.recentRemove}
              className="mr-1 grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-line hover:text-ink"
              onClick={() => { void forget(r.id); }}>
              <CloseIcon size={16} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
