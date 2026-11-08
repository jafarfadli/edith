"use client";

import { useSyncExternalStore } from "react";
import { isMac } from "@/lib/keys";

const noSubscribe = () => () => {};

/** isMac() for render output: false on the server and during hydration, the real answer right after (no mismatch). */
export function useIsMac(): boolean {
  return useSyncExternalStore(noSubscribe, isMac, () => false);
}
