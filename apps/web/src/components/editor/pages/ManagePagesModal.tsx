"use client";

import { ArrowLeft, ArrowRight, CopyPlus, FilePlus2, FileUp, RotateCcw, RotateCw, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ApiError, getStructure, uploadDocument } from "@/lib/api";
import * as P from "@/lib/pages";
import { errorMessage, t } from "@/lib/strings";
import { editorStore, pageGeom, useEditor, type EditorDoc, type PageEntry } from "@/store/editor";
import { textStore } from "@/store/text";
import { Thumbnail } from "../Thumbnail";
import { ICON } from "../../ui/icon";
import { BACKDROP, BTN_DANGER, BTN_PRIMARY, BTN_QUIET, DIALOG, DIALOG_TITLE } from "../../ui/styles";
import { pickPdf } from "./importPdf";

const THUMB = 104;

function Tile({ entry, index, checked, onToggle }: { entry: PageEntry; index: number; checked: boolean; onToggle: (shift: boolean) => void }) {
  const info = useEditor((s) => s.info)!;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: entry.pageKey });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 }}
      {...attributes} {...listeners} data-testid="manage-page" data-page-key={entry.pageKey} aria-pressed={checked}
      onClick={(e) => onToggle(e.shiftKey)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(e.shiftKey); } }}
      className={`relative flex cursor-pointer flex-col items-center gap-1.5 rounded-lg p-2 transition-colors ${checked ? "bg-accent/15 ring-2 ring-inset ring-accent" : "hover:bg-hover"}`}>
      <div className="grid place-items-center" style={{ width: THUMB, height: THUMB * 1.42 }}>
        <Thumbnail entry={entry} geom={pageGeom(entry, info)} width={THUMB} />
      </div>
      <input type="checkbox" readOnly checked={checked} aria-label={t.pages.pageN(index + 1)} tabIndex={-1}
        className="pointer-events-none absolute left-3.5 top-3.5 h-4 w-4" />
      <span className={`text-2xs tabular-nums ${checked ? "font-medium text-accent-text" : "text-faint"}`}>{index + 1}</span>
    </div>
  );
}

/** Kelola Halaman: page operations on a copy of the document; Simpan applies them as one undo step. */
export function ManagePagesModal({ onClose }: { onClose: () => void }) {
  const [original] = useState(() => editorStore.getState().doc);
  const [draft, setDraft] = useState<EditorDoc>(original);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(false);
  useEffect(() => { closeRef.current = onClose; busyRef.current = busy; });
  const close = () => { if (!busyRef.current) closeRef.current(); };
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const keys = [...selected].filter((k) => draft.pages.some((p) => p.pageKey === k));
  const none = keys.length === 0;

  useEffect(() => {
    box.current?.focus();
    // Focus can fall to <body> when a clicked button becomes disabled: keep Escape working and keep editor shortcuts out.
    const onKey = (e: KeyboardEvent) => {
      if (box.current?.contains(e.target as Node)) return; // the dialog's own handler deals with it
      e.stopPropagation();
      if (e.key === "Escape" && !busyRef.current) closeRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  function toggle(key: string, shift: boolean) {
    setSelected(P.toggleSelection(draft, selected, anchor, key, shift));
    setAnchor(key);
  }

  function setSel(next: Set<string>) {
    setSelected(next);
    setAnchor(null);
  }

  function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    const to = draft.pages.findIndex((p) => p.pageKey === e.over!.id);
    setDraft((d) => P.movePage(d, String(e.active.id), to));
  }

  async function importFile() {
    const file = await pickPdf();
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const up = await uploadDocument(file, file.name);
      const st = await getStructure(up.doc_id);
      editorStore.getState().addImport(up.doc_id, st.pages, st.fields); // the registry, not the document: Batal leaves no pages
      void textStore.getState().loadImport(up.doc_id);
      setDraft((d) => P.importPages(d, P.insertIndex(d, selected), up.doc_id, st.pages.length));
    } catch (e) {
      setError(errorMessage(e instanceof ApiError ? e.code : "generic"));
    } finally {
      setBusy(false);
    }
  }

  function insertBlank() {
    setDraft((d) => {
      const at = P.insertIndex(d, selected);
      return P.insertPages(d, at, [P.blankPage(P.blankSizeLike(d.pages[Math.max(at - 1, 0)], editorStore.getState().info))]);
    });
  }

  function save() {
    if (draft !== original) editorStore.getState().replaceDoc(draft);
    onClose();
  }

  return (
    <div className={`${BACKDROP} items-center`} onPointerDown={close}>
      <div ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-label={t.pages.manage} data-testid="manage-pages"
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") close(); }}
        className={`${DIALOG} max-h-[85vh] w-[56rem] max-w-[95vw]`}>
        <div className="flex items-center gap-3 px-4 pb-3 pt-4">
          <span className={DIALOG_TITLE}>{t.pages.manage}</span>
          <span className="text-xs tabular-nums text-faint">{t.pages.selected(keys.length, draft.pages.length)}</span>
          <div className="flex-1" />
          <button className={BTN_QUIET} onClick={() => setSel(new Set(draft.pages.map((p) => p.pageKey)))}>{t.pages.selectAll}</button>
          <button className={BTN_QUIET} disabled={none} onClick={() => setSel(new Set())}>{t.pages.selectNone}</button>
        </div>
        <div role="toolbar" aria-label={t.pages.actions} className="flex flex-wrap items-center gap-0.5 border-y border-line bg-panel px-3 py-1.5">
          <button className={BTN_QUIET} disabled={none} onClick={() => setDraft((d) => P.rotatePages(d, keys, -90))}><RotateCcw {...ICON} />{t.editor.rotateLeft}</button>
          <button className={BTN_QUIET} disabled={none} onClick={() => setDraft((d) => P.rotatePages(d, keys, 90))}><RotateCw {...ICON} />{t.editor.rotateRight}</button>
          <button className={BTN_QUIET} disabled={none} onClick={() => setDraft((d) => P.duplicatePages(d, keys))}><CopyPlus {...ICON} />{t.pages.duplicateShort}</button>
          <button className={BTN_QUIET} disabled={none} onClick={() => setDraft((d) => P.shiftPages(d, keys, -1))}><ArrowLeft {...ICON} />{t.pages.moveLeft}</button>
          <button className={BTN_QUIET} disabled={none} onClick={() => setDraft((d) => P.shiftPages(d, keys, 1))}>{t.pages.moveRight}<ArrowRight {...ICON} /></button>
          <button className={BTN_DANGER} disabled={none || keys.length >= draft.pages.length}
            onClick={() => { setDraft((d) => P.deletePages(d, keys)); setSel(new Set()); }}><Trash2 {...ICON} />{t.editor.delete}</button>
          <span aria-hidden className="mx-1.5 h-5 w-px bg-line-strong" />
          <button className={BTN_QUIET} onClick={insertBlank}><FilePlus2 {...ICON} />{t.pages.blank}</button>
          <button className={BTN_QUIET} disabled={busy} onClick={() => void importFile()}><FileUp {...ICON} />{busy ? t.pages.importing : t.pages.importPdf}</button>
        </div>
        {error && <p role="alert" className="px-4 pt-3 text-danger-text">{error}</p>}
        <div className="min-h-0 flex-1 overflow-y-auto bg-canvas/40 p-3">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={draft.pages.map((p) => p.pageKey)} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2">
                {draft.pages.map((entry, i) => (
                  <Tile key={entry.pageKey} entry={entry} index={i} checked={selected.has(entry.pageKey)} onToggle={(shift) => toggle(entry.pageKey, shift)} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
          <button disabled={busy} onClick={close} className={BTN_QUIET}>{t.pages.cancel}</button>
          <button disabled={busy} onClick={save} className={BTN_PRIMARY}>{t.pages.save}</button>
        </div>
      </div>
    </div>
  );
}
