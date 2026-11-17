"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import { t } from "@/lib/strings";
import { readTabs } from "@/lib/tabs";
import { toolKey } from "@/lib/toolKeys";
import { downloadStore } from "@/store/download";
import { editorStore, type Tool } from "@/store/editor";
import { BACKDROP, DIALOG } from "../ui/styles";
import { Kbd } from "../ui/Tooltip";
import { commandStore, type UiCommand } from "./commands";
import { openFind } from "./find/findStore";
import { pasteClipboard } from "./objects/clipboard";
import { selectAll } from "./objects/group";
import { cropStore } from "./pages/cropStore";
import { currentPage } from "./placement";
import { sideStore } from "./SidePane";
import { isTyping } from "./useShortcuts";

export const paletteStore = createStore<{ open: boolean; set(open: boolean): void }>()((set) => ({
  open: false,
  set: (open) => set({ open }),
}));

type Group = "tools" | "insert" | "document" | "view";
export interface Command {
  id: string; group: Group; label: string;
  /** Other words people search it by (Indonesian, everyday). */
  words: string; keys?: string;
  run(): void;
  /** Hidden while false (needs two documents open, for example). */
  when?: () => boolean;
}

const tool = (id: Tool, label: string, words: string): Command => ({
  id: `tool:${id}`, group: "tools", label, words, keys: toolKey(id), run: () => editorStore.getState().setTool(id),
});
const ask = (name: UiCommand) => () => commandStore.getState().ask(name);

/** Everything the editor can do, for the palette. */
export function commands(): Command[] {
  const zoom = (z: (cur: number) => number) => () => { const s = editorStore.getState(); s.setZoom(z(s.zoom)); };
  return [
    tool("select", t.editor.select, "pilih pindah geser objek"),
    tool("text", t.editor.text, "teks tulis ketik edit teks tambah teks"),
    tool("ocr", t.ocr.areaTool, "ocr baca teks scan gambar kenali"),
    tool("whiteout", t.editor.whiteout, "hapus tutup putih tipe-x"),
    tool("redact", t.editor.redact, "sensor hitam rahasia hapus permanen"),
    tool("highlight", t.annot.highlight, "stabilo tandai kuning"),
    tool("underline", t.annot.underline, "garis bawah"),
    tool("strike", t.annot.strike, "coret garis tengah"),
    tool("ink", t.editor.draw, "gambar bebas pensil coretan"),
    tool("rect", t.editor.rect, "kotak persegi bentuk"),
    tool("ellipse", t.editor.ellipse, "lingkaran oval bentuk"),
    tool("line", t.editor.line, "garis lurus"),
    tool("arrow", t.editor.arrow, "panah tunjuk"),
    tool("polygon", t.editor.polygon, "segi banyak bentuk"),
    tool("polyline", t.editor.polyline, "garis bersambung"),
    tool("cloud", t.editor.cloud, "awan revisi tanda"),
    tool("check", t.annot.check, "centang ceklis tanda"),
    tool("cross", t.annot.cross, "silang x tanda"),
    tool("capture", t.capture.tool, "salin area potong logo tabel ambil gambar screenshot"),
    tool("pan", t.editor.pan, "geser halaman tangan"),
    { id: "autoRedact", group: "tools", label: t.redact.find, words: "sensor otomatis nik npwp nomor hp email rekening data pribadi privasi",
      run: () => { editorStore.getState().setTool("redact"); commandStore.getState().ask("autoRedact"); } },
    { id: "image", group: "insert", label: t.annot.uploadImage, words: "gambar foto logo sisipkan masukkan", run: ask("uploadImage") },
    { id: "signature", group: "insert", label: t.annot.signature, words: "tanda tangan ttd paraf", run: ask("signature") },
    { id: "stamp", group: "insert", label: t.annot.stamp, words: "stempel cap disetujui lunas", run: ask("stamp") },
    { id: "paste", group: "insert", label: t.objects.paste, words: "tempel paste", keys: "Mod+V", run: () => { pasteClipboard(); } },
    { id: "undo", group: "document", label: t.editor.undo, words: "batal urungkan kembali", keys: "Mod+Z", run: () => editorStore.getState().undo() },
    { id: "redo", group: "document", label: t.editor.redo, words: "ulangi", keys: "Mod+Shift+Z", run: () => editorStore.getState().redo() },
    { id: "find", group: "document", label: t.find.title, words: "cari ganti temukan replace", keys: "Mod+F", run: openFind },
    { id: "selectAll", group: "document", label: t.palette.selectAll, words: "pilih semua objek", keys: "Mod+A", run: () => { selectAll(); } },
    { id: "pages", group: "document", label: t.pages.manage, words: "halaman urutkan hapus halaman putar sisipkan impor gabung", run: ask("managePages") },
    { id: "crop", group: "document", label: t.crop.title, words: "potong pangkas halaman", run: () => { const at = currentPage(); if (at) cropStore.getState().open(at.entry.pageKey); } },
    { id: "download", group: "document", label: t.editor.download, words: "unduh simpan save", run: ask("download") },
    { id: "downloadOptions", group: "document", label: t.downloadOptions.title, words: "unduh gambar kompres kunci sandi halaman tertentu png jpg", run: () => downloadStore.getState().open() },
    { id: "openPdf", group: "document", label: t.tabs.openAnother, words: "buka pdf lain tab baru dokumen lain", run: ask("openPdf") },
    { id: "side", group: "view", label: t.side.open, words: "berdampingan dua pdf samping banding seret", when: () => readTabs().length > 1,
      run: () => {
        const here = editorStore.getState().info?.editId;
        const other = readTabs().find((x) => x.id !== here);
        if (other) sideStore.getState().show(other.id);
      } },
    { id: "zoomIn", group: "view", label: t.editor.zoomIn, words: "perbesar besar", run: zoom((z) => Math.round((z + 0.1) * 10) / 10) },
    { id: "zoomOut", group: "view", label: t.editor.zoomOut, words: "perkecil kecil", run: zoom((z) => Math.round((z - 0.1) * 10) / 10) },
    { id: "zoom100", group: "view", label: t.palette.zoom100, words: "ukuran asli normal 100", run: zoom(() => 1) },
  ];
}

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** The commands matching `query` (every word of it found in the name or the other words), the best first: a name
 *  starting with the query, then a name holding it, then the rest. */
export function search(all: Command[], query: string): Command[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return all;
  const q = fold(query.trim());
  const scored = all.flatMap((c) => {
    const name = fold(c.label), hay = `${name} ${fold(c.words)}`;
    if (!words.every((w) => hay.includes(w))) return [];
    return [{ c, score: name.startsWith(q) ? 0 : name.includes(q) ? 1 : 2 }];
  });
  return scored.sort((a, b) => a.score - b.score).map((x) => x.c);
}

/** Ctrl/Cmd+K (or ?): find anything the editor does by name or by what it is for, and run it. With no query it is
 *  the list of everything, with the shortcuts. */
export function CommandPalette() {
  const open = useStore(paletteStore, (s) => s.open);
  const [query, setQuery] = useState("");
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const all = useMemo(() => (open ? commands().filter((c) => !c.when || c.when()) : []), [open]);
  const found = search(all, query);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && k === "k" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        paletteStore.getState().set(!paletteStore.getState().open);
      } else if (e.key === "?" && !e.metaKey && !e.ctrlKey && !isTyping(e.target)) {
        e.preventDefault();
        paletteStore.getState().set(true);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  useEffect(() => {
    if (!open) return;
    setQuery(""); // eslint-disable-line react-hooks/set-state-in-effect -- a fresh search each time it opens
    setAt(0);
    requestAnimationFrame(() => input.current?.focus());
  }, [open]);

  useEffect(() => { list.current?.querySelector(`[data-index="${at}"]`)?.scrollIntoView({ block: "nearest" }); }, [at]);

  if (!open) return null;
  const close = () => paletteStore.getState().set(false);
  const run = (c: Command | undefined) => { if (!c) return; close(); c.run(); };
  // Group names only over the whole list (a search is one list, best first).
  const head = (i: number) => (!query.trim() && (i === 0 || found[i - 1].group !== found[i].group) ? found[i].group : null);
  return createPortal(
    <div className={`${BACKDROP} items-start pt-[12vh]`} onPointerDown={close}>
      <div role="dialog" aria-label={t.palette.title} data-testid="command-palette" onPointerDown={(e) => e.stopPropagation()}
        className={`${DIALOG} w-[34rem] max-w-[calc(100vw-2rem)] overflow-hidden`}>
        <input ref={input} value={query} placeholder={t.palette.placeholder} aria-label={t.palette.placeholder}
          role="combobox" aria-expanded aria-controls="palette-list" aria-activedescendant={found[at] ? `palette-${found[at].id}` : undefined}
          onChange={(e) => { setQuery(e.target.value); setAt(0); }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "ArrowDown") { e.preventDefault(); setAt((i) => Math.min(found.length - 1, i + 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setAt((i) => Math.max(0, i - 1)); }
            else if (e.key === "Enter") { e.preventDefault(); run(found[at]); }
            else if (e.key === "Escape") { e.preventDefault(); close(); }
          }}
          className="h-12 border-b border-line bg-transparent px-4 text-base text-ink outline-none placeholder:text-faint" />
        <ul ref={list} id="palette-list" role="listbox" aria-label={t.palette.title} className="max-h-[min(26rem,60vh)] overflow-y-auto p-1.5">
          {found.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">{t.palette.none}</li>}
          {found.map((c, i) => {
            const group = head(i);
            return (
              <li key={c.id} role="presentation">
                {group && <p className="px-2.5 pb-1 pt-2.5 text-2xs font-medium uppercase tracking-[0.12em] text-faint">{t.palette.groups[group]}</p>}
                <div id={`palette-${c.id}`} role="option" aria-selected={i === at} data-index={i}
                  onPointerMove={() => setAt(i)} onClick={() => run(c)}
                  className={`flex h-9 cursor-pointer items-center gap-3 rounded-md px-2.5 text-sm ${i === at ? "bg-hover text-ink" : "text-muted"}`}>
                  <span className="min-w-0 flex-1 truncate">{c.label}</span>
                  {c.keys && <Kbd keys={c.keys} />}
                </div>
              </li>
            );
          })}
        </ul>
        <p className="border-t border-line px-4 py-2 text-2xs text-faint">{t.palette.footer}</p>
      </div>
    </div>,
    document.body,
  );
}
