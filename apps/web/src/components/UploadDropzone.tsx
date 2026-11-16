"use client";

import { FileUp, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ApiError, getSourceFile, uploadDocument } from "@/lib/api";
import { putSource, saveRecord } from "@/lib/library";
import { errorMessage, t } from "@/lib/strings";
import { BTN_PRIMARY, BTN_QUIET, FIELD } from "./ui/styles";

const MAX_BYTES = 50 * 1024 * 1024;

const isPdf = (file: File) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

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

  // Secondary text on the white sheet (≥ 4.5:1 there), or on the dark drag-over fill.
  const secondary = over ? "text-muted" : "text-paper-ink/65";

  return (
    // Narrower on phones so "Pilih file" stays above the fold; the error hangs under the sheet without moving it.
    <div className="relative w-full max-w-[16rem] md:max-w-[22rem]">
      <div
        data-testid="dropzone"
        onDragOver={(e) => { e.preventDefault(); if (!busy && !inFlight.current) setOver(true); }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false); }}
        onDrop={(e) => { e.preventDefault(); setOver(false); if (!busy && !inFlight.current) handle(e.dataTransfer.files[0]); }}
        // A blank page waiting on the canvas: the drop target has the proportions of an A4 sheet.
        className={`flex aspect-[210/297] w-full flex-col items-center justify-center gap-5 rounded-sm px-8 text-center shadow-page transition-colors ${over ? "bg-accent/10 outline-2 outline-offset-4 outline-accent outline-dashed" : "bg-paper outline-1 outline-offset-4 outline-line-strong outline-dashed"}`}
      >
        <span aria-hidden className={`grid h-12 w-12 place-items-center rounded-full ${over ? "bg-accent text-accent-ink" : "bg-accent/10 text-accent"}`}>
          <FileUp size={22} strokeWidth={1.75} />
        </span>
        <div className="flex flex-col gap-1">
          <p className={`text-base font-medium ${over ? "text-ink" : "text-paper-ink"}`}>{t.upload.drop}</p>
          <p className={`text-xs ${secondary}`}>{t.upload.or}</p>
        </div>
        {locked ? (
          <form className="flex w-full flex-col items-stretch gap-2 text-left" data-testid="locked-form"
            onSubmit={(e) => { e.preventDefault(); if (password) void handle(locked, password); }}>
            <p className="text-sm font-medium text-paper-ink">{t.locked.title}</p>
            <p className={`text-2xs ${secondary}`}>{t.locked.hint}</p>
            <input className={FIELD} type="password" autoFocus autoComplete="off" aria-label={t.locked.password}
              placeholder={t.locked.password} value={password} onChange={(e) => setPassword(e.target.value)} data-testid="locked-password" />
            <div className="flex justify-end gap-2">
              <button type="button" className={BTN_QUIET} onClick={() => { setLocked(null); setError(null); }}>{t.locked.cancel}</button>
              <button type="submit" disabled={busy || !password} className={BTN_PRIMARY}>
                {busy && <LoaderCircle size={16} strokeWidth={1.75} aria-hidden className="animate-spin" />}
                {t.locked.open}
              </button>
            </div>
          </form>
        ) : (
          <button type="button" disabled={busy} onClick={() => input.current?.click()} className={BTN_PRIMARY}>
            {busy && <LoaderCircle size={16} strokeWidth={1.75} aria-hidden className="animate-spin" />}
            {t.upload.choose}
          </button>
        )}
        {busy ? <p className={`text-2xs ${secondary}`} role="status">{t.upload.processing}</p> : <p className={`text-2xs ${secondary}`}>{t.upload.limit}</p>}
        <input ref={input} type="file" accept="application/pdf,.pdf" hidden data-testid="file-input" onChange={(e) => handle(e.target.files?.[0])} />
      </div>
      {error && <p role="alert" className="absolute inset-x-0 top-full mt-4 text-center text-sm text-danger-text">{error}</p>}
    </div>
  );
}
