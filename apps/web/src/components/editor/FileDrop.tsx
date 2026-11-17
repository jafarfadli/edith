"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/api";
import type { NoticeMsg } from "@/lib/notices";
import { openPdf } from "@/lib/openPdf";
import { errorMessage, t } from "@/lib/strings";
import { UploadIcon } from "../brand/icons";
import { insertImage } from "./insertImage";
import { afterTextCommitted } from "./text/textEdit";

const MAX_BYTES = 50 * 1024 * 1024;
const isPdf = (type: string, name = "") => type === "application/pdf" || name.toLowerCase().endsWith(".pdf");
const isPicture = (type: string, name = "") => ["image/png", "image/jpeg"].includes(type) || /\.(png|jpe?g)$/i.test(name);

/** Files dropped anywhere on the editor: a PDF opens beside this one as a new tab, a PNG or JPEG lands on the page in
 *  view as a picture. While files are held over the window a sheet says which will happen. */
export function FileDrop({ onNotice }: { onNotice: (n: NoticeMsg | null) => void }) {
  const router = useRouter();
  const [held, setHeld] = useState<"pdf" | "image" | "file" | null>(null);
  const depth = useRef(0);

  useEffect(() => {
    const files = (e: DragEvent) => !!e.dataTransfer?.types.includes("Files");
    const kind = (e: DragEvent): "pdf" | "image" | "file" => {
      const type = e.dataTransfer?.items?.[0]?.type ?? "";
      return isPdf(type) ? "pdf" : isPicture(type) ? "image" : "file";
    };
    const enter = (e: DragEvent) => { if (!files(e)) return; depth.current++; setHeld(kind(e)); };
    const over = (e: DragEvent) => { if (files(e)) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"; } };
    const leave = (e: DragEvent) => { if (files(e) && --depth.current <= 0) { depth.current = 0; setHeld(null); } };
    const drop = (e: DragEvent) => {
      if (!files(e)) return;
      e.preventDefault();
      depth.current = 0;
      setHeld(null);
      const f = e.dataTransfer?.files[0];
      if (!f) return;
      if (isPdf(f.type, f.name)) {
        if (f.size > MAX_BYTES) { onNotice({ kind: "error", text: errorMessage("too_large") }); return; }
        onNotice({ kind: "info", text: t.drop.opening(f.name) });
        openPdf(f).then((path) => afterTextCommitted(() => router.push(path)), (err) => {
          const code = err instanceof ApiError ? err.code : "generic";
          onNotice({ kind: "error", text: code === "pdf_encrypted" ? t.tabs.locked : errorMessage(code) });
        });
      } else if (isPicture(f.type, f.name)) {
        void insertImage(f, onNotice);
      } else {
        onNotice({ kind: "error", text: t.drop.unknown });
      }
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [onNotice, router]);

  if (!held) return null;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-base/60 p-6">
      <div className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-accent bg-raised px-10 py-8 text-center shadow-modal">
        <UploadIcon size={28} className="text-accent-text" />
        <p className="text-sm font-medium text-ink">{t.drop[held]}</p>
      </div>
    </div>
  );
}
