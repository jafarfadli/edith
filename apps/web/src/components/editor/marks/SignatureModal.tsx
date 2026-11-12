"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { SignatureAdd } from "@edith/ops";
import { ApiError, uploadAsset } from "@/lib/api";
import { putAsset } from "@/lib/library";
import { cssFamily, fontStore } from "@/lib/fonts";
import { newId } from "@/lib/id";
import {
  dataUrlToBlob, loadSignatures, removeSignature, saveSignature, SIGNATURE_COLORS, SIGNATURE_FONTS, signatureRect, type SavedSignature,
} from "@/lib/signatures";
import { errorMessage, t } from "@/lib/strings";
import { editorStore } from "@/store/editor";
import { ICON } from "../../ui/icon";
import { BACKDROP, BTN_ICON, BTN_PRIMARY, BTN_QUIET, DIALOG, DIALOG_TITLE, FIELD, SEGMENTED, segment, swatch } from "../../ui/styles";
import { currentPage, placeObject } from "../placement";
import { cropDrawing, loadUpload, renderTyped, scriptFont, type SignatureImage } from "./signatureCanvas";

type NoticeFn = (n: { kind: "error" | "info"; text: string }) => void;
type Tab = "draw" | "type" | "upload";
const PAD_W = 480, PAD_H = 160;

/** Uploads `img` as an asset of the open document and places it on the page in view, selected. */
async function placeSignature(img: SignatureImage): Promise<void> {
  const st = editorStore.getState();
  const at = currentPage();
  if (!st.info || !at) return;
  const blob = dataUrlToBlob(img.dataUrl);
  const asset = await uploadAsset(st.info.docId, blob);
  void putAsset(st.info.editId, asset.asset_id, blob).catch(() => undefined); // kept for when the server drops the document
  const op: SignatureAdd = { id: newId(), type: "signature.add", pageKey: at.entry.pageKey, rect: signatureRect(img.width, img.height, at.size), assetId: asset.asset_id };
  placeObject(op);
}

function Colors({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div role="radiogroup" aria-label={t.editor.color} className="flex gap-2">
      {SIGNATURE_COLORS.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={value === c} aria-label={t.signature.colors[c]} onClick={() => onChange(c)}
          className={swatch(value === c)} style={{ background: c }} />
      ))}
    </div>
  );
}

function DrawPad({ color, canvasRef }: { color: string; canvasRef: React.RefObject<HTMLCanvasElement | null> }) {
  const last = useRef<[number, number] | null>(null);
  const at = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    return [((e.clientX - r.left) * PAD_W) / r.width, ((e.clientY - r.top) * PAD_H) / r.height];
  };
  return (
    <canvas ref={canvasRef} width={PAD_W} height={PAD_H} data-testid="signature-pad"
      className="w-full touch-none rounded-lg bg-paper" style={{ aspectRatio: `${PAD_W} / ${PAD_H}` }}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); last.current = at(e); }}
      onPointerMove={(e) => {
        if (!last.current) return;
        const c = e.currentTarget.getContext("2d")!;
        const p = at(e);
        c.strokeStyle = color; c.lineWidth = 3; c.lineCap = "round"; c.lineJoin = "round";
        c.beginPath(); c.moveTo(...last.current); c.lineTo(...p); c.stroke();
        last.current = p;
      }}
      onPointerUp={() => { last.current = null; }} />
  );
}

/** Tanda tangan: draw, type (4 script fonts, 3 colors) or upload; optionally keep it in this browser's library. */
export function SignatureModal({ onClose, onNotice }: { onClose: () => void; onNotice: NoticeFn }) {
  const [tab, setTab] = useState<Tab>("type");
  const [color, setColor] = useState<string>(SIGNATURE_COLORS[0]);
  const [name, setName] = useState("");
  const [family, setFamily] = useState<string>(SIGNATURE_FONTS[0]);
  const [file, setFile] = useState<File | null>(null);
  const [save, setSave] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<SavedSignature[]>(() => loadSignatures());
  const pad = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  // Escape only reaches the dialog when focus is inside it (the name field takes it on the Ketik tab).
  useEffect(() => { if (!box.current?.contains(document.activeElement)) box.current?.focus(); }, []);

  useEffect(() => { SIGNATURE_FONTS.forEach((f) => { fontStore.load(scriptFont(f)).catch(() => {}); }); }, []);

  async function run(make: () => Promise<SignatureImage | null>, keep: boolean) {
    setBusy(true);
    try {
      const img = await make();
      if (!img) return;
      if (keep && !saveSignature({ id: newId(), ...img }).saved) onNotice({ kind: "info", text: t.signature.tooBig });
      await placeSignature(img);
      onClose();
    } catch (e) {
      onNotice({ kind: "error", text: errorMessage(e instanceof ApiError ? e.code : "generic") });
    } finally {
      setBusy(false);
    }
  }

  function make(): Promise<SignatureImage | null> {
    if (tab === "type") return name.trim() ? renderTyped(name.trim(), family, color) : Promise.resolve(null);
    if (tab === "draw") return Promise.resolve(pad.current ? cropDrawing(pad.current) : null);
    return file ? loadUpload(file) : Promise.resolve(null);
  }

  return (
    <div className={`${BACKDROP} items-start pt-20`} onPointerDown={onClose}>
      <div ref={box} tabIndex={-1} role="dialog" aria-label={t.signature.title} data-testid="signature-modal" onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") onClose(); }}
        className={`${DIALOG} w-[34rem] max-w-[calc(100vw-2rem)] gap-4 p-4`}>
        <div className="flex items-center gap-2">
          <span className={DIALOG_TITLE}>{t.signature.title}</span>
          <div className="flex-1" />
          <button aria-label={t.editor.close} onClick={onClose} className={BTN_ICON}><X {...ICON} /></button>
        </div>
        {saved.length > 0 && (
          <section aria-label={t.signature.saved} className="flex flex-col gap-1">
            <span className="text-xs text-muted">{t.signature.saved}</span>
            <div className="flex flex-wrap gap-2">
              {saved.map((sig) => (
                <div key={sig.id} className="relative">
                  <button aria-label={t.signature.use} disabled={busy} onClick={() => run(async () => sig, false)}
                    className="h-14 w-36 rounded-md bg-paper p-1 ring-2 ring-transparent transition-shadow hover:ring-accent">
                    {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL from localStorage */}
                    <img src={sig.dataUrl} alt="" className="h-full w-full object-contain" />
                  </button>
                  <button aria-label={t.signature.remove} onClick={() => setSaved(removeSignature(sig.id))}
                    className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-raised text-muted shadow-pop hover:text-danger-text"><X size={12} strokeWidth={2} aria-hidden /></button>
                </div>
              ))}
            </div>
          </section>
        )}
        <div role="tablist" className={`self-start ${SEGMENTED}`}>
          {(["draw", "type", "upload"] as const).map((k) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={segment(tab === k)}>{t.signature[k]}</button>
          ))}
        </div>
        {tab === "draw" && (
          <div className="flex flex-col gap-2">
            <DrawPad color={color} canvasRef={pad} />
            <div className="flex items-center gap-2">
              <Colors value={color} onChange={setColor} />
              <div className="flex-1" />
              <button type="button" onClick={() => pad.current?.getContext("2d")!.clearRect(0, 0, PAD_W, PAD_H)} className={BTN_QUIET}>{t.signature.clear}</button>
            </div>
          </div>
        )}
        {tab === "type" && (
          <div className="flex flex-col gap-2">
            <input aria-label={t.signature.name} placeholder={t.signature.name} value={name} autoFocus onChange={(e) => setName(e.target.value)}
              className={FIELD} />
            <div role="radiogroup" aria-label={t.signature.font} className="grid grid-cols-2 gap-2">
              {SIGNATURE_FONTS.map((f) => (
                <button key={f} type="button" role="radio" aria-checked={family === f} aria-label={f} onClick={() => setFamily(f)}
                  className={`truncate rounded-md bg-paper px-2 py-2 text-2xl ring-2 ${family === f ? "ring-accent" : "ring-transparent hover:ring-line-strong"}`}
                  style={{ fontFamily: `"${cssFamily(scriptFont(f))}"`, color }}>
                  {name.trim() || f}
                </button>
              ))}
            </div>
            <Colors value={color} onChange={setColor} />
          </div>
        )}
        {tab === "upload" && (
          <input type="file" accept="image/png,image/jpeg" aria-label={t.signature.upload} data-testid="signature-file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-sm text-muted file:mr-3 file:h-8 file:cursor-pointer file:rounded-md file:border-0 file:bg-hover file:px-3 file:text-ink file:ring-1 file:ring-inset file:ring-line-strong" />
        )}
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-muted"><input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} />{t.signature.save}</label>
          <div className="flex-1" />
          <button onClick={() => run(make, save)} disabled={busy} className={BTN_PRIMARY}>{t.signature.add}</button>
        </div>
      </div>
    </div>
  );
}
