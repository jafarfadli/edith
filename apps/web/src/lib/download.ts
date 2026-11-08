import { ApiError } from "@/lib/api";
import type { NoticeMsg } from "@/lib/notices";
import { errorMessage, t } from "@/lib/strings";

/** What saveBlob/openBlob need from the browser (tests pass fakes). */
export interface SaveEnv {
  createAnchor(): HTMLAnchorElement;
  append(el: HTMLElement): void;
  createUrl(blob: Blob): string;
  revokeLater(url: string): void;
  open(url: string): Window | null;
}

/** A blob URL opened in a tab must outlive the tab's load; one used by an <a download> click must outlive a slow
 *  "Save as" dialog and the browser reading the blob (a revoked URL makes some browsers save a failed download). */
const OPEN_REVOKE_MS = 60_000;
const CLICK_REVOKE_MS = 40_000;

function browserEnv(revokeMs: number): SaveEnv {
  return {
    createAnchor: () => document.createElement("a"),
    append: (el) => document.body.appendChild(el),
    createUrl: (blob) => URL.createObjectURL(blob),
    revokeLater: (url) => { setTimeout(() => URL.revokeObjectURL(url), revokeMs); },
    open: (url) => window.open(url, "_blank"), // not "noopener": with it window.open always returns null
  };
}

/** Opens `blob` in a new tab (the browser's PDF viewer, which can save it). False when the popup was blocked. */
export function openBlob(blob: Blob, env: SaveEnv = browserEnv(OPEN_REVOKE_MS)): boolean {
  const url = env.createUrl(blob);
  const w = env.open(url);
  env.revokeLater(url);
  if (!w) return false;
  w.opener = null;
  return true;
}

export type SaveResult = "downloaded" | "opened" | "blocked";

/** Saves `blob` as `filename` through an <a download> click; when the browser cannot (no download attribute, or the
 *  click throws, e.g. in a sandboxed frame) it opens the PDF in a new tab instead; "blocked" when that fails too. */
export function saveBlob(blob: Blob, filename: string, env?: SaveEnv): SaveResult {
  const click = env ?? browserEnv(CLICK_REVOKE_MS);
  const a = click.createAnchor();
  if ("download" in a) {
    const url = click.createUrl(blob);
    try {
      a.href = url;
      a.download = filename;
      click.append(a);
      a.click();
      return "downloaded";
    } catch {
      // fall through to the new tab
    } finally {
      a.remove();
      click.revokeLater(url);
    }
  }
  return openBlob(blob, env ?? browserEnv(OPEN_REVOKE_MS)) ? "opened" : "blocked";
}

/** What the server's safe_filename strips too: path separators, characters Windows reserves, control characters. */
const RESERVED = new Set([..."\\/:*?\"<>|"]);
const allowed = (ch: string) => { const c = ch.codePointAt(0)!; return c > 0x1f && c !== 0x7f && !RESERVED.has(ch); };

function cleanName(name: string): string | null {
  const n = [...name].filter(allowed).join("").trim();
  const hasExt = /\.pdf$/i.test(n);
  const base = (hasExt ? n.slice(0, -4) : n).replace(/^[\s.]+|[\s.]+$/g, "");
  return base ? base + (hasExt ? n.slice(-4) : ".pdf") : null;
}

/** The name a download is saved under: `name` (the file name field) cleaned like the server's safe_filename, spaces
 *  and dots trimmed, ending in .pdf; never just ".pdf": then `original`'s name (cleaned), else "document.pdf". */
export function downloadName(name: string, original?: string): string {
  return cleanName(name) ?? (original ? cleanName(original) : null) ?? "document.pdf";
}

/** The notice after saveBlob: "Mengunduh …" only for a real download (with the new-tab fallback in case the browser
 *  dropped it silently); a PDF that opened in a tab says so; a blocked one offers the tab as the way out. */
export function savedNotice(result: SaveResult, name: string, openTab: NonNullable<NoticeMsg["action"]>): NoticeMsg {
  if (result === "blocked") return { kind: "error", text: t.download.blocked, action: openTab };
  if (result === "opened") return { kind: "info", text: t.download.opened };
  return { kind: "info", text: t.download.started(name), action: openTab };
}

/** True when `blob` starts with the PDF signature (a proxy can answer 200 with an HTML error page). */
export async function isPdfBlob(blob: Blob): Promise<boolean> {
  const head = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
  return String.fromCharCode(...head) === "%PDF-";
}

export interface DownloadFailure { code: string; message: string; retry: boolean }

/** Codes worth a "Coba lagi": the same request may well work a moment later. */
const RETRY = new Set(["network", "timeout", "internal", "bad_response", "generic"]);

/** The user-facing message for anything that went wrong while exporting, and whether a retry makes sense. */
export function downloadError(e: unknown): DownloadFailure {
  if (!(e instanceof ApiError)) return { code: "generic", message: t.errors.generic, retry: true };
  const { code, status } = e;
  if (code === "generic" || code === "http_error" || code === "not_found") {
    if (status >= 500) return { code, message: t.download.server(status), retry: true };
    if (status === 404) return { code: "not_found", message: t.errors.not_found, retry: false };
    if (status >= 400) return { code, message: t.download.refused(status), retry: false };
    return { code: "generic", message: t.errors.generic, retry: true };
  }
  return { code, message: errorMessage(code), retry: RETRY.has(code) };
}
