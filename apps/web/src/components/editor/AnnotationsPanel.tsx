"use client";

import type { ContentOp } from "@edith/ops";
import { objectLabel } from "@/lib/objectLabels";
import { t } from "@/lib/strings";
import { editorStore, useEditor } from "@/store/editor";
import { scrollToPage } from "./ZoomPill";

/** Every object added to the document, grouped by page in page order: a click goes to it and selects it. */
export function AnnotationsPanel() {
  const pages = useEditor((s) => s.doc.pages);
  const order = useEditor((s) => s.doc.order);
  const objects = useEditor((s) => s.doc.objects);
  const selection = useEditor((s) => s.selection);
  const groups = pages
    .map((p, i) => ({ pageKey: p.pageKey, n: i + 1, ops: order.map((id) => objects[id]).filter((op): op is ContentOp => !!op && op.pageKey === p.pageKey) }))
    .filter((g) => g.ops.length);

  if (!groups.length) return <p className="px-2 py-4 text-xs text-muted">{t.panel.empty}</p>;

  function go(op: ContentOp) {
    const s = editorStore.getState();
    s.setTool("select");
    s.select(op.id);
    s.setCurrentPage(op.pageKey);
    scrollToPage(op.pageKey);
  }

  return (
    <div className="flex flex-col gap-3" data-testid="annotations-panel">
      {groups.map((g) => (
        <section key={g.pageKey} aria-label={t.pages.pageN(g.n)}>
          <h3 className="px-1 pb-1 text-xs font-medium text-muted">{t.pages.pageN(g.n)}</h3>
          <ul className="flex flex-col gap-0.5">
            {g.ops.map((op) => {
              const { icon, label, detail } = objectLabel(op);
              return (
                <li key={op.id} className={`group flex items-center rounded-md ${selection === op.id ? "bg-accent/10" : "hover:bg-bg"}`}>
                  <button onClick={() => go(op)} data-testid="annotation-item" className="flex min-w-0 flex-1 items-center gap-2 px-1.5 py-1 text-left text-xs">
                    <span aria-hidden className="w-4 shrink-0 text-center">{icon}</span>
                    <span className="shrink-0">{label}</span>
                    {detail && <span className="truncate text-muted">{detail}</span>}
                  </button>
                  <button aria-label={t.panel.deleteItem(label)} title={t.editor.delete} onClick={() => editorStore.getState().deleteObject(op.id)}
                    className="px-1.5 text-xs text-muted opacity-0 hover:text-danger focus-visible:opacity-100 group-hover:opacity-100">✕</button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
