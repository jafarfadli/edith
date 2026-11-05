"use client";

import { useEffect, useState } from "react";
import { assetUrl } from "@/lib/api";

const cache = new Map<string, HTMLImageElement>();

export function useImageAsset(docId: string, assetId: string): HTMLImageElement | undefined {
  const key = `${docId}/${assetId}`;
  const [img, setImg] = useState(() => cache.get(key));
  useEffect(() => {
    if (cache.has(key)) { setImg(cache.get(key)); return; }
    const el = new Image();
    el.crossOrigin = "anonymous";
    el.onload = () => { cache.set(key, el); setImg(el); };
    el.src = assetUrl(docId, assetId);
  }, [key, docId, assetId]);
  return img;
}
