"use client";

import type { ContentOp } from "@edith/ops";
import {
  ArrowUpRight, Check, Circle, Cloud, Eraser, EyeOff, Highlighter, Image, Link2, MessageSquare, Pencil, Pentagon, Signature, Slash,
  Spline, Square, Stamp, Strikethrough, Type, Underline, X, type LucideIcon,
} from "lucide-react";
import { useRef } from "react";
import { listedObjects, objectLabel, type ObjectIcon } from "@/lib/objectLabels";
import { t } from "@/lib/strings";
import { editorStore, useEditor } from "@/store/editor";
import { ICON_SM } from "../ui/icon";
import { scrollToPage } from "./ZoomPill";

const ICONS: Record<ObjectIcon, LucideIcon> = {
  text: Type, textEdit: Type, image: Image, signature: Signature, rect: Square, ellipse: Circle, line: Slash, arrow: ArrowUpRight,
  polygon: Pentagon, polyline: Spline, cloud: Cloud, ink: Pencil, whiteout: Eraser, redact: EyeOff, stamp: Stamp, check: Check, cross: X,
  link: Link2, note: MessageSquare, highlight: Highlighter, underline: Underline, strike: Strikethrough,
};

/** Every object added to the document, grouped by page in page order: a click goes to it and selects it. */
export function AnnotationsPanel() {
  const pages = useEditor((s) => s.doc.pages);
  const order = useEditor((s) => s.doc.order);
  const objects = useEditor((s) => s.doc.objects);
  const selection = useEditor((s) => s.selection);
  const groups = listedObjects({ pages, order, objects });
  const root = useRef<HTMLDivElement>(null);

  if (!groups.length) return <div ref={root} tabIndex={-1} className="outline-none"><p className="px-2 py-4 text-xs leading-relaxed text-faint">{t.panel.empty}</p></div>;

  function remove(op: ContentOp) {
    const items = Array.from(root.current?.querySelectorAll<HTMLElement>("[data-testid=annotation-item]") ?? []);
    const idx = items.findIndex((el) => el.dataset.opId === op.id);
    editorStore.getState().deleteObject(op.id);
    setTimeout(() => {
      const left = root.current?.querySelectorAll<HTMLElement>("[data-testid=annotation-item]");
      (left && left.length ? left[Math.min(Math.max(idx, 0), left.length - 1)] : root.current)?.focus();
    }, 0);
  }

  function go(op: ContentOp) {
    const s = editorStore.getState();
    s.setTool("select");
    s.select(op.id);
    s.setCurrentPage(op.pageKey);
    scrollToPage(op.pageKey);
  }

  return (
    <div ref={root} tabIndex={-1} className="flex flex-col gap-4 outline-none" data-testid="annotations-panel">
      {groups.map((g) => (
        <section key={g.pageKey} aria-label={t.pages.pageN(g.n)}>
          <h3 className="px-2 pb-1 text-2xs font-medium uppercase tracking-wider text-faint">{t.pages.pageN(g.n)}</h3>
          <ul className="flex flex-col gap-0.5">
            {g.ops.map((op) => {
              const { icon, label, detail } = objectLabel(op);
              const Icon = ICONS[icon];
              return (
                <li key={op.id} className={`group flex items-center rounded-md ${selection === op.id ? "bg-accent/20 text-accent-text" : "text-ink hover:bg-hover"}`}>
                  <button onClick={() => go(op)} data-testid="annotation-item" data-op-id={op.id} className="flex h-8 min-w-0 flex-1 items-center gap-2 px-2 text-left text-xs">
                    <Icon {...ICON_SM} className="shrink-0 text-muted" />
                    <span className="shrink-0">{label}</span>
                    {detail && <span className="truncate text-faint">{detail}</span>}
                  </button>
                  <button aria-label={t.panel.deleteItem(label)} title={t.editor.delete} onClick={() => remove(op)}
                    className="grid h-8 w-7 place-items-center text-faint opacity-0 hover:text-danger-text focus-visible:opacity-100 group-hover:opacity-100"><X {...ICON_SM} /></button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
