"use client";

import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import type { BundledFont } from "@edith/ops";
import { fontKey, fontStore } from "@/lib/fonts";
import { substituteOf } from "@/lib/paragraphs";
import { findMatches, nextMatchIndex } from "@/lib/search";
import { t } from "@/lib/strings";
import { buildTargets } from "@/lib/targets";
import { editorStore, useEditor } from "@/store/editor";
import { textStore, useText } from "@/store/text";
import { commitOpenSession, whenTextCommitted } from "../text/textEdit";
import { isFindKey } from "../useShortcuts";
import { findStore } from "./findStore";
import { applyReplacements } from "./replace";

function reveal(pageKey: string) {
  // The page itself, not its thumbnail (which carries the same data-page-key and comes first in the DOM).
  document.querySelector(`[data-testid="page"][data-page-key="${pageKey}"]`)?.scrollIntoView({ block: "center" });
}

export function FindBar() {
  const f = useStore(findStore);
  const doc = useEditor((s) => s.doc);
  const pages = useText((s) => s.pages);
  const status = useText((s) => s.status);
  const fonts = useText((s) => s.fonts);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!f.open) return;
    input.current?.focus();
    input.current?.select();
  }, [f.open, f.focusTick]);

  useEffect(() => {
    if (!f.open) return;
    // Highlights of original paragraphs are measured with the bundled fonts their runs show in: load
    // them (again once the text finishes loading, when Find was opened before).
    const needed = new Map<string, BundledFont>();
    for (const ps of Object.values(pages)) for (const p of ps) for (const r of p.runs) {
      const sub = substituteOf(r.font, fonts);
      needed.set(fontKey(sub), sub);
    }
    void Promise.allSettled([...needed.values()].map((font) => fontStore.load(font)))
      .then(() => findStore.getState().set({ fontsVersion: findStore.getState().fontsVersion + 1 }));
  }, [f.open, pages, fonts]);

  useEffect(() => {
    if (!f.open) return;
    const matches = findMatches(buildTargets(doc, pages), f.query, f.caseSensitive);
    findStore.getState().set({ matches, current: Math.min(findStore.getState().current, Math.max(0, matches.length - 1)) });
  }, [f.open, f.query, f.caseSensitive, doc, pages]);

  if (!f.open) return null;
  const n = f.matches.length;
  const go = (delta: number) => {
    if (!n) return;
    const current = (f.current + delta + n) % n;
    f.set({ current });
    reveal(f.matches[current].pageKey);
  };
  const replace = async (all: boolean) => {
    if (!n || busy) return;
    setBusy(true);
    try {
      // An open rich-text session lands first; the matches are then taken from the document as it is now.
      await commitOpenSession();
      await whenTextCommitted();
      const { query, caseSensitive, replacement, current } = findStore.getState();
      const search = () => {
        const targets = buildTargets(editorStore.getState().doc, textStore.getState().pages);
        return { order: targets.map((x) => x.key), matches: findMatches(targets, query, caseSensitive) };
      };
      const fresh = search().matches;
      if (!fresh.length) return;
      const one = fresh[Math.min(current, fresh.length - 1)];
      const [done] = await applyReplacements(all ? fresh : [one], replacement);
      if (all || !done) return;
      // Continue after the new text (it may contain the query itself), in this target or a later one.
      const after = search();
      const next = nextMatchIndex(after.matches, after.order, done.key, done.end);
      findStore.getState().set({ matches: after.matches, current: next });
      if (after.matches[next]) reveal(after.matches[next].pageKey);
    } catch (err) {
      console.warn("replace failed", err);
    } finally {
      setBusy(false);
    }
  };
  const close = () => f.set({ open: false, matches: [] });
  const btn = "h-8 rounded-md px-2 text-sm hover:bg-bg disabled:opacity-40";

  return (
    <div role="search" aria-label={t.find.title} data-testid="find-bar"
      className="fixed right-4 top-28 z-30 flex w-[26rem] flex-col gap-2 rounded-xl border border-line bg-surface p-2 shadow-lg"
      onKeyDown={(e) => {
        if (e.key === "Escape") { e.preventDefault(); close(); }
        if (isFindKey(e)) return; // the window shortcut re-focuses the query
        e.stopPropagation();
      }}>
      <div className="flex items-center gap-1">
        <button type="button" aria-label={t.find.toggleReplace} aria-expanded={f.showReplace} className={btn}
          onClick={() => f.set({ showReplace: !f.showReplace })}>{f.showReplace ? "▾" : "▸"}</button>
        <input ref={input} aria-label={t.find.query} value={f.query} placeholder={t.find.query}
          onChange={(e) => f.set({ query: e.target.value, current: 0 })}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); go(e.shiftKey ? -1 : 1); } }}
          className="min-w-0 flex-1 rounded border border-line px-2 py-1 text-sm" />
        <span className="w-20 text-center text-xs tabular-nums text-muted" aria-live="polite">
          {status === "loading" ? t.find.loading : t.find.count(n ? f.current + 1 : 0, n)}
        </span>
        <button type="button" aria-label={t.find.caseSensitive} aria-pressed={f.caseSensitive} title={t.find.caseSensitive}
          className={`${btn} ${f.caseSensitive ? "bg-accent/10 text-accent" : ""}`} onClick={() => f.set({ caseSensitive: !f.caseSensitive })}>Aa</button>
        <button type="button" aria-label={t.find.prev} disabled={!n} className={btn} onClick={() => go(-1)}>↑</button>
        <button type="button" aria-label={t.find.next} disabled={!n} className={btn} onClick={() => go(1)}>↓</button>
        <button type="button" aria-label={t.editor.close} className={btn} onClick={close}>✕</button>
      </div>
      {f.showReplace && (
        <div className="flex items-center gap-1 pl-9">
          <input aria-label={t.find.replacement} value={f.replacement} placeholder={t.find.replacement}
            onChange={(e) => f.set({ replacement: e.target.value })}
            className="min-w-0 flex-1 rounded border border-line px-2 py-1 text-sm" />
          <button type="button" disabled={!n || busy} className={btn} onClick={() => void replace(false)}>{t.find.replace}</button>
          <button type="button" disabled={!n || busy} className={btn} onClick={() => void replace(true)}>{t.find.replaceAll}</button>
        </div>
      )}
    </div>
  );
}
