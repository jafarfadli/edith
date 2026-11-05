"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ApiError, uploadDocument } from "@/lib/api";
import { errorMessage, t } from "@/lib/strings";

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

  return (
    <div
      data-testid="dropzone"
      onDragOver={(e) => { e.preventDefault(); if (!busy && !inFlight.current) setOver(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false); }}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (!busy && !inFlight.current) handle(e.dataTransfer.files[0]); }}
      className={`flex w-full max-w-xl flex-col items-center gap-4 rounded-2xl border-2 border-dashed px-8 py-14 text-center transition ${over ? "border-accent bg-accent/5" : "border-line bg-surface"}`}
    >
      <p className="text-lg font-medium">{t.upload.drop}</p>
      <p className="text-sm text-muted">{t.upload.or}</p>
      <button
        type="button"
        disabled={busy}
        onClick={() => input.current?.click()}
        className="rounded-lg bg-accent px-5 py-2.5 font-medium text-accent-ink hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {t.upload.choose}
      </button>
      {busy ? (
        <p className="text-sm text-muted" role="status">{t.upload.processing}</p>
      ) : (
        <p className="text-xs text-muted">{t.upload.limit}</p>
      )}
      <input ref={input} type="file" accept="application/pdf,.pdf" hidden data-testid="file-input" onChange={(e) => handle(e.target.files?.[0])} />
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}
