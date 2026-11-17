"use client";

import { FileText, FileUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ApiError } from "@/lib/api";
import { listed, parseIndex, rawIndex, subscribeIndex } from "@/lib/library";
import type { NoticeMsg } from "@/lib/notices";
import { editPath, openPdf } from "@/lib/openPdf";
import { errorMessage, t } from "@/lib/strings";
import { closeTab, openTab, subscribeTabs, tabsServerSnapshot, tabsSnapshot } from "@/lib/tabs";
import { useEditor } from "@/store/editor";
import { CloseIcon, PlusIcon, SpinnerIcon } from "../brand/icons";
import { ICON } from "../ui/icon";
import { MenuButton, type MenuItem } from "./MenuButton";
import { afterTextCommitted } from "./text/textEdit";

const MAX_BYTES = 50 * 1024 * 1024;

/** Goes to another document's editor once the open text box is in this one's draft. */
function useGoTo() {
  const router = useRouter();
  return (path: string) => afterTextCommitted(() => router.push(path));
}

/** The menu that opens another PDF beside this one: a file from the device, or one of the recent edits. It becomes a
 *  tab; what was copied here can be pasted there. */
export function OpenAnother({ onNotice, className, children }: {
  onNotice: (n: NoticeMsg | null) => void; className: string; children: React.ReactNode;
}) {
  const go = useGoTo();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const here = useEditor((s) => s.info?.editId);
  const index = useSyncExternalStore(subscribeIndex, rawIndex, () => "[]");
  const open = new Set(useSyncExternalStore(subscribeTabs, tabsSnapshot, tabsServerSnapshot).map((x) => x.id));
  const recent = listed(parseIndex(index)).filter((r) => r.id !== here).slice(0, 6);

  async function pick(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_BYTES) { onNotice({ kind: "error", text: errorMessage("too_large") }); return; }
    setBusy(true);
    try {
      go(await openPdf(file));
    } catch (e) {
      const code = e instanceof ApiError ? e.code : "generic";
      onNotice({ kind: "error", text: code === "pdf_encrypted" ? t.tabs.locked : errorMessage(code) });
      setBusy(false);
    } finally {
      if (input.current) input.current.value = "";
    }
  }

  const items: MenuItem[] = [
    { label: t.tabs.fromDevice, icon: FileUp, run: () => input.current?.click() },
    ...recent.map((r) => ({ label: open.has(r.id) ? `${r.name} · ${t.tabs.isOpen}` : r.name, icon: FileText, run: () => go(editPath(r.id, r.name)) })),
  ];
  return (
    <>
      <MenuButton label={t.tabs.openAnother} items={items} className={className} width={264}>
        {busy ? <SpinnerIcon {...ICON} className="animate-spin" /> : children}
      </MenuButton>
      <input ref={input} type="file" accept="application/pdf,.pdf" hidden data-testid="open-another-input"
        onChange={(e) => void pick(e.target.files?.[0])} />
    </>
  );
}

/** The row of open documents under the top bar, once there are two or more: a press shows one (its own editor, with
 *  its own undo), × or a middle click takes it off the row. The document shown joins the row by itself. */
export function DocTabs({ onNotice }: { onNotice: (n: NoticeMsg | null) => void }) {
  const go = useGoTo();
  const info = useEditor((s) => s.info);
  const tabs = useSyncExternalStore(subscribeTabs, tabsSnapshot, tabsServerSnapshot);
  useEffect(() => { if (info) openTab({ id: info.editId, name: info.fileName }); }, [info]);

  if (!info || tabs.length < 2) return null;
  const close = (id: string) => {
    const next = closeTab(id);
    if (id === info.editId) go(next ? editPath(next.id, next.name) : "/");
  };
  return (
    <nav aria-label={t.tabs.row} data-testid="doc-tabs"
      className="flex h-9 shrink-0 items-end gap-0.5 overflow-x-auto border-b border-line bg-panel px-2 [scrollbar-width:none]">
      {tabs.map((tab) => {
        const active = tab.id === info.editId;
        return (
          <div key={tab.id} className={`group relative flex h-8 max-w-52 shrink-0 items-center rounded-t-md text-xs ${active ? "bg-canvas text-ink after:absolute after:inset-x-2 after:top-0 after:h-0.5 after:rounded-full after:bg-accent" : "text-muted hover:bg-hover hover:text-ink"}`}>
            <button type="button" aria-current={active ? "page" : undefined} title={tab.name}
              onClick={() => { if (!active) go(editPath(tab.id, tab.name)); }}
              onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); close(tab.id); } }}
              className="flex h-full min-w-0 items-center gap-1.5 truncate pl-3 pr-1 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent">
              <FileText size={13} aria-hidden className="shrink-0 opacity-60" />
              <span className="truncate">{tab.name}</span>
            </button>
            <button type="button" aria-label={t.tabs.close(tab.name)} onClick={() => close(tab.id)}
              className={`mr-1 grid h-5 w-5 shrink-0 place-items-center rounded text-faint hover:bg-hover hover:text-ink focus-visible:opacity-100 ${active ? "" : "opacity-0 group-hover:opacity-100"}`}>
              <CloseIcon size={12} aria-hidden />
            </button>
          </div>
        );
      })}
      <OpenAnother onNotice={onNotice} className="mb-1 grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted hover:bg-hover hover:text-ink">
        <PlusIcon size={15} aria-hidden />
      </OpenAnother>
    </nav>
  );
}
