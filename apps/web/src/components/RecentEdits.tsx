"use client";

import { FileText, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ago, forget, listed, parseIndex, rawIndex, subscribeIndex, tidy } from "@/lib/library";
import { t } from "@/lib/strings";
import { ICON } from "./ui/icon";

/** The edits this browser kept, newest first: opening one continues it (with its changes); uploading a file always
 *  starts a clean edit. Shown on the start page only when there are any. */
export function RecentEdits() {
  const raw = useSyncExternalStore(subscribeIndex, rawIndex, () => "[]"); // (nothing is listed on the server)
  const items = useMemo(() => listed(parseIndex(raw)), [raw]);
  const [now] = useState(() => Date.now());

  useEffect(() => { void tidy(); }, []);

  if (!items.length) return null;
  return (
    <section aria-labelledby="recent-title" data-testid="recent-edits" className="flex w-full max-w-md flex-col gap-2">
      <h2 id="recent-title" className="text-xs font-medium uppercase tracking-wide text-muted">{t.upload.recent}</h2>
      <ul className="flex flex-col gap-1">
        {items.map((r) => (
          <li key={r.id} className="group flex items-center gap-1 rounded-md ring-1 ring-inset ring-line hover:bg-hover">
            <Link href={`/edit/${r.id}?name=${encodeURIComponent(r.name)}`} className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2">
              <FileText {...ICON} aria-hidden className="shrink-0 text-accent-text" />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm text-ink">{r.name}</span>
                <span className="text-2xs text-muted">{ago(r.updatedAt, now)} · {t.upload.recentPages(r.pageCount)}</span>
              </span>
            </Link>
            <button type="button" aria-label={`${t.upload.recentRemove}: ${r.name}`} title={t.upload.recentRemove}
              className="mr-1 grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-line hover:text-ink"
              onClick={() => { void forget(r.id); }}>
              <X {...ICON} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
