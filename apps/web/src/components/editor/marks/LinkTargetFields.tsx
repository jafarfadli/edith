"use client";

import { useState } from "react";
import { isPageTarget, normalizeUrl, type LinkTarget } from "@/lib/links";
import { t } from "@/lib/strings";
import { useEditor } from "@/store/editor";

/** URL / page choice of a link. `onChange` gets the target on every change: a normalized URL, a page,
 *  or null while the typed URL is not valid (a hint shows when the field is left that way). */
export function LinkTargetFields({ target, onChange, autoFocus = false }: {
  target: LinkTarget | null; onChange: (t: LinkTarget | null) => void; autoFocus?: boolean;
}) {
  const pages = useEditor((s) => s.doc.pages);
  const [mode, setMode] = useState<"url" | "page">(target && isPageTarget(target) ? "page" : "url");
  const [url, setUrl] = useState(target && !isPageTarget(target) ? target.url : "");
  const [invalid, setInvalid] = useState(false);
  const pageKey = target && isPageTarget(target) ? target.pageKey : "";

  function typeUrl(v: string) {
    setUrl(v);
    setInvalid(false);
    const u = normalizeUrl(v);
    onChange(u ? { url: u } : null);
  }

  return (
    <div className="flex items-center gap-2 text-xs">
      <div role="radiogroup" className="flex rounded-md ring-1 ring-line">
        {(["url", "page"] as const).map((m) => (
          <button key={m} type="button" role="radio" aria-checked={mode === m}
            onClick={() => { setMode(m); onChange(m === "url" ? (normalizeUrl(url) ? { url: normalizeUrl(url)! } : null) : pageKey ? { pageKey } : null); }}
            className={`px-2 py-1 ${mode === m ? "bg-accent/10 text-accent" : "hover:bg-hover"}`}>
            {m === "url" ? t.link.toUrl : t.link.toPage}
          </button>
        ))}
      </div>
      {mode === "url" ? (
        <>
          <input aria-label={t.link.url} value={url} autoFocus={autoFocus} placeholder="https://"
            onChange={(e) => typeUrl(e.target.value)}
            onBlur={() => setInvalid(url.trim() !== "" && normalizeUrl(url) === null)}
            className="w-56 rounded border border-line px-1.5 py-1 text-ink" />
          {invalid && <span role="alert" className="text-danger-text">{t.link.invalidUrl}</span>}
        </>
      ) : (
        <select aria-label={t.link.page} value={pageKey} onChange={(e) => { if (e.target.value) onChange({ pageKey: e.target.value }); }}
          className="rounded border border-line px-1 py-1 text-ink">
          <option value="" disabled>{t.link.page}</option>
          {pages.map((p, i) => <option key={p.pageKey} value={p.pageKey}>{t.link.pageN(i + 1)}</option>)}
        </select>
      )}
    </div>
  );
}
