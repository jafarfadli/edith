"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError } from "@/lib/api";
import { handOff } from "@/lib/handoff";
import { openPdf } from "@/lib/openPdf";
import { errorMessage, t } from "@/lib/strings";
import type { ToolDef, ToolSlug } from "@/lib/tools";
import { SpinnerIcon } from "../brand/icons";
import { BTN_PRIMARY } from "../ui/styles";
import { TOOL_ICONS } from "./icons";

/** What people commonly do next with a PDF a tool made, most common first. */
const NEXT: ToolSlug[] = ["kompres-pdf", "nomor-halaman", "watermark-pdf", "kunci-pdf", "ukuran-kertas", "gabung-pdf", "ambil-halaman", "pdf-ke-gambar", "pdf-bisa-dicari"];

/** "Lanjutkan dengan": the PDF just made, straight into the editor or another tool, without saving and choosing it
 *  again. */
export function NextSteps({ result, from }: { result: { blob: Blob; name: string }; from: ToolDef }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const file = () => new File([result.blob], result.name, { type: "application/pdf" });

  async function edit() {
    setBusy(true);
    setError(null);
    try {
      router.push(await openPdf(file()));
    } catch (e) {
      setError(errorMessage(e instanceof ApiError ? e.code : "generic"));
      setBusy(false);
    }
  }

  return (
    <div className="flex w-full flex-col gap-2 rounded-lg bg-panel p-3 ring-1 ring-inset ring-line" data-testid="next-steps">
      <p className="text-xs text-muted">{t.tools.next.title}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" className={BTN_PRIMARY} onClick={() => void edit()} disabled={busy}>
          {busy && <SpinnerIcon size={14} className="animate-spin" aria-hidden />}{t.tools.next.edit}
        </button>
        {NEXT.filter((slug) => slug !== from.slug).map((slug) => {
          const Icon = TOOL_ICONS[slug];
          return (
            <button key={slug} type="button" onClick={() => { handOff(file()); router.push(`/tools/${slug}`); }}
              className="flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs text-ink ring-1 ring-inset ring-line transition-colors hover:bg-hover">
              <Icon size={14} strokeWidth={1.75} aria-hidden className="text-accent-text" />{t.tools.items[slug].name}
            </button>
          );
        })}
      </div>
      {error && <p role="alert" className="text-xs text-danger-text">{error}</p>}
    </div>
  );
}
