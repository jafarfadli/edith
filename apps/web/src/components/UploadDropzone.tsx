"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ApiError, getSourceFile, uploadDocument } from "@/lib/api";
import { putSource, saveRecord } from "@/lib/library";
import { errorMessage, t } from "@/lib/strings";
import { ScissorsIcon, SpinnerIcon, UploadIcon } from "./brand/icons";
import { BinderClip } from "./bench/Props";
import { BTN_PRIMARY, BTN_QUIET, FIELD } from "./ui/styles";

const MAX_BYTES = 50 * 1024 * 1024;

const isPdf = (file: File) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

/** A blank A4 sheet clipped to the bench: drop the PDF on it, or pick one. Its cut line runs while a file is held over
 *  it and is cut through (drawn solid in the accent) while the PDF goes up. */
export function UploadDropzone() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A locked PDF waiting for its password.
  const [locked, setLocked] = useState<File | null>(null);
  const [password, setPassword] = useState("");

  async function handle(file: File | undefined, pw?: string) {
    if (busy || inFlight.current) return;
    try {
      if (!file) return;
      setError(null);
      if (!pw) setLocked(null);
      if (!isPdf(file)) return setError(errorMessage("pdf_corrupt"));
      if (file.size > MAX_BYTES) return setError(errorMessage("too_large"));
      inFlight.current = true;
      setBusy(true);
      try {
        const res = await uploadDocument(file, file.name, pw);
        // A copy stays in this browser, so the edit goes on when the server has dropped its own (lib/session.ts): of a
        // locked PDF, the unlocked copy the server made (the password is not kept).
        saveRecord({ id: res.doc_id, serverId: res.doc_id, name: file.name, pageCount: res.page_count, edited: false, updatedAt: Date.now() });
        const copy = pw ? await getSourceFile(res.doc_id).catch(() => null) : file;
        if (copy) await putSource(res.doc_id, copy).catch(() => undefined);
        router.push(`/edit/${res.doc_id}?name=${encodeURIComponent(file.name)}`);
      } catch (e) {
        const code = e instanceof ApiError ? e.code : "generic";
        if (code === "pdf_encrypted") { setLocked(file); setPassword(""); }
        else setError(errorMessage(code));
        setBusy(false);
        inFlight.current = false;
      }
    } finally {
      if (input.current) input.current.value = "";
    }
  }

  return (
    // Narrower on phones so "Pilih PDF" stays above the fold; the error hangs under the sheet without moving it.
    <div className="relative w-full max-w-[17rem] md:max-w-[23rem]">
      <div
        data-testid="dropzone"
        onDragOver={(e) => { e.preventDefault(); if (!busy && !inFlight.current) setOver(true); }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false); }}
        onDrop={(e) => { e.preventDefault(); setOver(false); if (!busy && !inFlight.current) handle(e.dataTransfer.files[0]); }}
        className={`animate-settle relative flex aspect-[210/297] w-full flex-col items-center justify-center gap-5 rounded-[2px] bg-paper px-8 text-center text-paper-ink transition-[translate,box-shadow] duration-300 ease-out-expo ${over ? "-translate-y-1.5 shadow-sheet-lifted" : "shadow-sheet"}`}
      >
        {/* The cut line, with the scissors at its start. */}
        <svg aria-hidden className="pointer-events-none absolute inset-4 h-[calc(100%-2rem)] w-[calc(100%-2rem)] overflow-visible">
          {busy ? (
            <rect x="0" y="0" width="100%" height="100%" pathLength={1} fill="none" stroke="var(--accent)" strokeWidth="2" className="draw-in [animation-duration:1.4s]" />
          ) : (
            <rect x="0" y="0" width="100%" height="100%" fill="none" strokeDasharray="6 5" strokeWidth={over ? 1.5 : 1}
              stroke={over ? "var(--paper-ink)" : "oklch(70% 0.004 80)"} className={over ? "marching" : ""} />
          )}
        </svg>
        <span aria-hidden className="absolute left-7 top-[0.55rem] bg-paper px-1 text-paper-ink/60"><ScissorsIcon size={15} /></span>
        <BinderClip className="pointer-events-none absolute -top-8 left-1/2 w-14 -translate-x-1/2" />

        <UploadIcon size={38} strokeWidth={1.4} className={`transition-transform duration-300 ease-out-expo ${over ? "-translate-y-1" : ""}`} />
        <p className="font-wide text-lg font-semibold tracking-tight">{t.upload.drop}</p>
        {locked ? (
          <form className="flex w-full flex-col items-stretch gap-2 text-left" data-testid="locked-form"
            onSubmit={(e) => { e.preventDefault(); if (password) void handle(locked, password); }}>
            <p className="text-sm font-medium">{t.locked.title}</p>
            <p className="text-2xs text-paper-ink/65">{t.locked.hint}</p>
            <input className={FIELD} type="password" autoFocus autoComplete="off" aria-label={t.locked.password}
              placeholder={t.locked.password} value={password} onChange={(e) => setPassword(e.target.value)} data-testid="locked-password" />
            <div className="flex justify-end gap-2">
              <button type="button" className={`${BTN_QUIET} text-paper-ink/70 hover:text-paper-ink`} onClick={() => { setLocked(null); setError(null); }}>{t.locked.cancel}</button>
              <button type="submit" disabled={busy || !password} className={BTN_PRIMARY}>
                {busy && <SpinnerIcon size={16} className="animate-spin" />}
                {t.locked.open}
              </button>
            </div>
          </form>
        ) : (
          <button type="button" disabled={busy} onClick={() => input.current?.click()} className={`${BTN_PRIMARY} h-10 px-5 text-base`}>
            {busy && <SpinnerIcon size={16} className="animate-spin" />}
            {t.upload.choose}
          </button>
        )}
        {busy
          ? <p className="text-2xs text-paper-ink/65" role="status">{t.upload.processing}</p>
          : <p className="font-mono text-2xs text-paper-ink/65">{t.upload.limit}</p>}
        <input ref={input} type="file" accept="application/pdf,.pdf" hidden data-testid="file-input" onChange={(e) => handle(e.target.files?.[0])} />
      </div>
      {error && <p role="alert" className="absolute inset-x-0 top-full mt-5 text-center text-sm text-danger-text">{error}</p>}
    </div>
  );
}
