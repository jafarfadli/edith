"use client";

import { createElement } from "react";
import type { TextAdd } from "@edith/ops";
import { fontStore } from "@/lib/fonts";
import { relayout } from "@/lib/textbox";
import { editorStore } from "@/store/editor";
import { overlayHooks } from "../PageOverlay";
import { textPropsSlot } from "../PropertiesBar";
import { TextNode } from "./TextNode";
import { TextProps } from "./TextProps";
import { fontsReady, startTextAt, textEditStore } from "./textEdit";

let installed = false;

export function installTextTool(): void {
  if (installed) return;
  installed = true;

  overlayHooks.onTextPointerDown = startTextAt;

  overlayHooks.onDoubleClick = (op) => {
    if (op.type !== "text.add") return;
    editorStore.getState().select(null); // hide the transformer while the HTML editor is on top
    textEditStore.getState().start({ id: op.id, pageKey: op.pageKey, box: (op as TextAdd).box, isNew: false });
  };

  overlayHooks.renderText = (op) =>
    createElement(TextNode, { op, hidden: textEditStore.getState().editing?.id === op.id });

  // Only the left/right anchors are enabled for text: keep y, change x/width, re-wrap.
  overlayHooks.resizeText = (op, to) => {
    const box = { ...op.box, rect: { ...op.box.rect, x: to.x, w: Math.max(to.w, 10) } };
    return { ...op, box: fontsReady(box) ? relayout(box, (f) => fontStore.get(f)) : box };
  };

  textPropsSlot.render = () => createElement(TextProps);
}
