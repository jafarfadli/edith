import type { LinkAdd } from "@edith/ops";

const FULL = /^(https?:\/\/|mailto:)\S+$/i;
const BARE_HOST = /^[^\s/@:]+\.[^\s.]{2,}(\/\S*)?$/;

/** A URL the API accepts (http/https/mailto), adding https:// to a bare host like "example.com"; null otherwise. */
export function normalizeUrl(input: string): string | null {
  const v = input.trim();
  if (FULL.test(v)) return v;
  if (BARE_HOST.test(v)) return `https://${v}`;
  return null;
}

export type LinkTarget = LinkAdd["target"];

export function isPageTarget(t: LinkTarget): t is { pageKey: string } {
  return "pageKey" in t;
}
