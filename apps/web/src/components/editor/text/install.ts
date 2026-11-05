"use client";

import { createElement } from "react";
import { fontStore } from "@/lib/fonts";
import { isTextOp } from "@/lib/objects";
import { relayout } from "@/lib/textbox";
import { editorStore } from "@/store/editor";
import { MatchHighlights } from "../find/MatchHighlights";
import { overlayHooks } from "../PageOverlay";
import { textPropsSlot } from "../PropertiesBar";
import { ParagraphLayer } from "./ParagraphLayer";
import { TextNode } from "./TextNode";
import { TextProps } from "./TextProps";
import { fontsReady, startTextAt, textEditStore } from "./textEdit";

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

  overlayHooks.renderText = (op) =>
    createElement(TextNode, { op, hidden: textEditStore.getState().editing?.id === op.id });

  // Only the left/right anchors are enabled for text: keep y, change x/width, re-wrap.
  overlayHooks.resizeText = (op, to) => {
    const box = { ...op.box, rect: { ...op.box.rect, x: to.x, w: Math.max(to.w, 10) } };
    return { ...op, box: fontsReady(box) ? relayout(box, (f) => fontStore.get(f)) : box };
  };

  overlayHooks.renderUnder = (pageKey) => createElement(ParagraphLayer, { pageKey });
  overlayHooks.renderOver = (pageKey) => createElement(MatchHighlights, { pageKey });

  textPropsSlot.render = () => createElement(TextProps);
}
