"use client";

import { createElement } from "react";
import { fontStore } from "@/lib/fonts";
import { isTextOp, redrawAll } from "@/lib/objects";
import { textTargetAt } from "@/lib/textTarget";
import { relayout } from "@/lib/textbox";
import { editorStore } from "@/store/editor";
import { paragraphsOf } from "@/store/text";
import { MatchHighlights } from "../find/MatchHighlights";
import { overlayHooks } from "../PageOverlay";
import { textPropsSlot } from "../PropertiesBar";
import { ParagraphLayer } from "./ParagraphLayer";
import { TextNode } from "./TextNode";
import { TextProps } from "./TextProps";
import { fontsReady, startParagraphEdit, startTextAt, textEditStore } from "./textEdit";

let installed = false;

export function installTextTool(): void {
  if (installed) return;
  installed = true;

  overlayHooks.onTextPointerDown = startTextAt;

  overlayHooks.onDoubleClick = (op) => {
    if (!isTextOp(op)) return;
    editorStore.getState().select(null); // hide the transformer while the rich editor is on top
    textEditStore.getState().start(op.type === "text.edit"
      ? { id: op.id, pageKey: op.pageKey, box: op.box, isNew: false, kind: "text.edit", paragraphId: op.paragraphId }
      : { id: op.id, pageKey: op.pageKey, box: op.box, isNew: false, kind: "text.add" });
  };

  // A markup sits above its text: double-clicking it edits what is under it, like double-clicking the text.
  overlayHooks.onMarkupDoubleClick = (pageKey, at) => {
    const { doc } = editorStore.getState();
    const entry = doc.pages.find((p) => p.pageKey === pageKey);
    const ops = doc.order.map((id) => doc.objects[id]).filter((op) => !!op && op.pageKey === pageKey);
    const target = textTargetAt(ops, entry ? paragraphsOf(entry.src) : [], at);
    if (!target) return;
    if ("op" in target) overlayHooks.onDoubleClick?.(target.op);
    else void startParagraphEdit(pageKey, target.paragraph);
  };

  overlayHooks.renderText = (op) =>
    createElement(TextNode, { op, hidden: textEditStore.getState().editing?.id === op.id });

  // Only the left/right anchors are enabled for text: keep y, change x/width, re-wrap.
  overlayHooks.resizeText = (op, to) => {
    // Resized, the original lines cannot stay (relayout drops `source`; so must the fallback while fonts load).
    const box = redrawAll({ ...op.box, rect: { ...op.box.rect, x: to.x, w: Math.max(to.w, 10) } });
    return { ...op, box: fontsReady(box) ? relayout(box, (f) => fontStore.get(f)) : box };
  };

  overlayHooks.renderUnder = (pageKey) => createElement(ParagraphLayer, { pageKey });
  overlayHooks.renderOver = (pageKey) => createElement(MatchHighlights, { pageKey });

  textPropsSlot.render = () => createElement(TextProps);
}
