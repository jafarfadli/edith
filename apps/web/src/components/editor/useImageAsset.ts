"use client";

import { useEffect, useState } from "react";
import { assetUrl } from "@/lib/api";

const cache = new Map<string, HTMLImageElement>();

/** The decoded image for an asset, or undefined while loading or after it failed (callers draw a placeholder). */
export function useImageAsset(docId: string, assetId: string): HTMLImageElement | undefined {
  const key = `${docId}/${assetId}`;
  // Only the load result is state, tagged with its key, so a changed key never shows the previous image.
  const [loaded, setLoaded] = useState<{ key: string; img: HTMLImageElement | null } | null>(null);
  const cached = cache.get(key);

  useEffect(() => {
    if (cache.has(key)) return;
    let alive = true;
    const el = new Image();
    el.crossOrigin = "anonymous";
    el.onload = () => { cache.set(key, el); if (alive) setLoaded({ key, img: el }); };
    el.onerror = () => { if (alive) setLoaded({ key, img: null }); };
    el.src = assetUrl(docId, assetId);
    return () => { alive = false; };
  }, [key, docId, assetId]);

  if (cached) return cached;
  return loaded?.key === key ? loaded.img ?? undefined : undefined;
}
