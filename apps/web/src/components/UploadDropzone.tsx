"use client";

import { FileUp, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ApiError, uploadDocument } from "@/lib/api";
import { errorMessage, t } from "@/lib/strings";
import { BTN_PRIMARY } from "./ui/styles";

const MAX_BYTES = 50 * 1024 * 1024;

const isPdf = (file: File) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

export function UploadDropzone() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handle(file: File | undefined) {
    if (busy || inFlight.current) return;
    try {
      if (!file) return;
      setError(null);
      if (!isPdf(file)) return setError(errorMessage("pdf_corrupt"));
      if (file.size > MAX_BYTES) return setError(errorMessage("too_large"));
      inFlight.current = true;
      setBusy(true);
      try {
        const res = await uploadDocument(file, file.name);
        router.push(`/edit/${res.doc_id}?name=${encodeURIComponent(file.name)}`);
      } catch (e) {
        setError(errorMessage(e instanceof ApiError ? e.code : "generic"));
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
        <button type="button" disabled={busy} onClick={() => input.current?.click()} className={BTN_PRIMARY}>
          {busy && <LoaderCircle size={16} strokeWidth={1.75} aria-hidden className="animate-spin" />}
          {t.upload.choose}
        </button>
        {busy ? <p className={`text-2xs ${secondary}`} role="status">{t.upload.processing}</p> : <p className={`text-2xs ${secondary}`}>{t.upload.limit}</p>}
        <input ref={input} type="file" accept="application/pdf,.pdf" hidden data-testid="file-input" onChange={(e) => handle(e.target.files?.[0])} />
      </div>
      {error && <p role="alert" className="absolute inset-x-0 top-full mt-4 text-center text-sm text-danger-text">{error}</p>}
    </div>
  );
}
