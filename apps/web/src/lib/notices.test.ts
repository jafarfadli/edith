import { describe, expect, it } from "vitest";
import { ACTION_NOTICE_MS, INFO_NOTICE_MS, noticeLifetime } from "@/lib/notices";

describe("noticeLifetime", () => {
  const action = { label: "Buka di tab baru", run: () => {} };

  it("errors stay until closed", () => {
    expect(noticeLifetime({ kind: "error", text: "x" })).toBeNull();
    expect(noticeLifetime({ kind: "error", text: "x", action })).toBeNull();
  });

  it("info goes after 5 s, but an info notice with a button stays 20 s", () => {
    expect(noticeLifetime({ kind: "info", text: "x" })).toBe(INFO_NOTICE_MS);
    expect(INFO_NOTICE_MS).toBe(5_000);
    expect(noticeLifetime({ kind: "info", text: "x", action })).toBe(ACTION_NOTICE_MS);
    expect(ACTION_NOTICE_MS).toBe(20_000);
  });
});
