import type { LinkAdd } from "@edith/ops";

/** Same as the API's UrlTarget (apps/api/edith/ops.py): the scheme is lower case there, so it is lowercased here. */
export const MAX_URL = 2048;
const FULL = /^(https?:\/\/|mailto:)\S+$/;
const FILE_EXT = /\.(pdf|docx?|xlsx?|pptx?|txt|png|jpe?g|gif|zip|csv|html?)$/i; // bare file names are not hosts
const SCHEME = /^(https?:\/\/|mailto:)/i;
/** A host with at least one dot and a letters-only TLD of 2+ chars ("1.50" does not; bare file names are excluded by FILE_EXT). */
const BARE_HOST = /^[^\s/@:.]+(\.[^\s/@:.]+)*\.[a-z]{2,}(\/\S*)?$/i;

/**
 * `url` with every UTF-8 byte that would break the PDF literal string the export writes the URI into
 * (`\`, `(`, `)`), plus controls, spaces and non-ASCII, percent-encoded; `%` is kept, so it is idempotent.
 * Same as the API's safe_uri (apps/api/edith/bake/util.py) — change both together.
 */
export function encodeUnsafe(url: string): string {
  let out = "";
  for (const b of new TextEncoder().encode(url)) {
    out += b <= 0x20 || b >= 0x7f || b === 0x5c || b === 0x28 || b === 0x29
      ? `%${b.toString(16).toUpperCase().padStart(2, "0")}`
      : String.fromCharCode(b);
  }
  return out;
}

function encodedWithinLimit(url: string): string | null {
  const encoded = encodeUnsafe(url);
  return encoded.length <= MAX_URL ? encoded : null;
}

/**
 * A URL the API accepts (http/https/mailto), adding https:// to a bare host like "example.com", with
 * the characters the PDF string cannot hold percent-encoded (what the export stores); null otherwise.
 */
export function normalizeUrl(input: string): string | null {
  const v = input.trim();
  if (v.length > MAX_URL) return null;
  const m = SCHEME.exec(v);
  if (m) {
    const lowered = m[0].toLowerCase() + v.slice(m[0].length);
    return FULL.test(lowered) ? encodedWithinLimit(lowered) : null;
  }
  const host = v.split("/")[0];
  return BARE_HOST.test(v) && !(v === host && FILE_EXT.test(host)) ? encodedWithinLimit(`https://${v}`) : null;
}

export type LinkTarget = LinkAdd["target"];

export function isPageTarget(t: LinkTarget): t is { pageKey: string } {
  return "pageKey" in t;
}
