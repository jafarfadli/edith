import type { LinkAdd } from "@edith/ops";

/** Same as the API's UrlTarget (apps/api/edith/ops.py): the scheme is lower case there, so it is lowercased here. */
export const MAX_URL = 2048;
const FULL = /^(https?:\/\/|mailto:)\S+$/;
const FILE_EXT = /\.(pdf|docx?|xlsx?|pptx?|txt|png|jpe?g|gif|zip|csv|html?)$/i; // bare file names are not hosts
const SCHEME = /^(https?:\/\/|mailto:)/i;
/** A host with at least one dot and a letters-only TLD of 2+ chars ("file.pdf" still passes: a TLD-ish name; "1.50" does not). */
const BARE_HOST = /^[^\s/@:.]+(\.[^\s/@:.]+)*\.[a-z]{2,}(\/\S*)?$/i;

/** A URL the API accepts (http/https/mailto), adding https:// to a bare host like "example.com"; null otherwise. */
export function normalizeUrl(input: string): string | null {
  const v = input.trim();
  if (v.length > MAX_URL) return null;
  const m = SCHEME.exec(v);
  if (m) {
    const lowered = m[0].toLowerCase() + v.slice(m[0].length);
    return FULL.test(lowered) ? lowered : null;
  }
  const bare = `https://${v}`;
  const host = v.split("/")[0];
  return BARE_HOST.test(v) && !(v === host && FILE_EXT.test(host)) && bare.length <= MAX_URL ? bare : null;
}

export type LinkTarget = LinkAdd["target"];

export function isPageTarget(t: LinkTarget): t is { pageKey: string } {
  return "pageKey" in t;
}
