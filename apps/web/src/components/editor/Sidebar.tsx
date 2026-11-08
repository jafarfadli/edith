"use client";

import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useState } from "react";
import { t } from "@/lib/strings";
import { editorStore, pageGeom, useEditor, type PageEntry } from "@/store/editor";
import { AnnotationsPanel } from "./AnnotationsPanel";
import { MenuButton } from "./MenuButton";
import { PageMenu } from "./PageMenu";
import { importPdf, pickPdf } from "./pages/importPdf";
import { Thumbnail } from "./Thumbnail";
import { scrollToPage } from "./ZoomPill";

/** "+" between pages: a blank page or the pages of another PDF go there. */
function InsertButton({ after }: { after: string | null }) {
  const scroll = (k: string | undefined) => { if (k) setTimeout(() => scrollToPage(k), 50); };
  return (
    <div className="group mx-auto my-1 flex h-5 w-full items-center justify-center">
      <MenuButton label={t.pages.insert} className="grid h-5 w-5 place-items-center rounded-full bg-surface text-xs text-muted opacity-0 ring-1 ring-line transition group-hover:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100" items={[
        { label: t.pages.blank, run: () => scroll(editorStore.getState().insertBlankAfter(after)) },
        { label: t.pages.importPdf, run: () => void pickPdf().then(async (f) => { if (f) scroll((await importPdf(f, after))[0]); }) },
      ]}>+</MenuButton>
    </div>
  );
}

function SortableThumb({ entry, index, count, active }: { entry: PageEntry; index: number; count: number; active: boolean }) {
  const info = useEditor((s) => s.info)!;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: entry.pageKey });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 }}>
      <div
        data-testid="thumb"
        data-page-key={entry.pageKey}
        {...attributes}
        {...listeners}
        onClick={() => scrollToPage(entry.pageKey)}
        className={`relative mx-auto w-fit cursor-pointer rounded-md p-1 ${active ? "ring-2 ring-accent" : "hover:ring-1 hover:ring-line"}`}
      >
        <Thumbnail entry={entry} geom={pageGeom(entry, info)} />
        <PageMenu pageKey={entry.pageKey} index={index} count={count} />
        <p className="mt-1 text-center text-xs text-muted">{index + 1}</p>
      </div>
    </div>
  );
}

export function Sidebar() {
  const [tab, setTab] = useState<"pages" | "annotations">("pages");
  const count = useEditor((s) => s.doc.order.length);
  const tabBtn = (k: typeof tab, label: string) => (
    <button role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
      className={`flex-1 rounded-md px-2 py-1 text-xs ${tab === k ? "bg-accent/10 font-medium text-accent" : "text-muted hover:bg-bg"}`}>{label}</button>
  );
  return (
    <aside className="flex w-48 shrink-0 flex-col border-r border-line bg-surface" aria-label={t.editor.pages}>
      <div role="tablist" className="flex gap-1 border-b border-line p-1.5">
        {tabBtn("pages", t.panel.pages)}
        {tabBtn("annotations", count ? `${t.panel.annotations} (${count})` : t.panel.annotations)}
      </div>
      <div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        {tab === "pages" ? <PageThumbs /> : <AnnotationsPanel />}
      </div>
    </aside>
  );
}

function PageThumbs() {
  const pages = useEditor((s) => s.doc.pages);
  const current = useEditor((s) => s.currentPage);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    const to = pages.findIndex((p) => p.pageKey === e.over!.id);
    editorStore.getState().movePage(String(e.active.id), to);
  }

  return (
    <>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={pages.map((p) => p.pageKey)} strategy={verticalListSortingStrategy}>
          <InsertButton after={null} />
          {pages.map((entry, i) => (
            <div key={entry.pageKey}>
              <SortableThumb entry={entry} index={i} count={pages.length} active={entry.pageKey === current} />
              <InsertButton after={entry.pageKey} />
            </div>
          ))}
        </SortableContext>
      </DndContext>
    </>
  );
}
