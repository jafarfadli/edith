import { describe, expect, it } from "vitest";
import { commands, search } from "./CommandPalette";

describe("command palette search", () => {
  const all = commands();
  const first = (q: string) => search(all, q)[0]?.id;

  it("finds commands by their name and by everyday words", () => {
    expect(first("sensor")).toBe("tool:redact");
    expect(search(all, "sensor nik").map((c) => c.id)).toEqual(["autoRedact"]);
    expect(first("ttd")).toBe("signature");
    expect(first("salin area")).toBe("tool:capture");
    expect(first("unduh")).toBe("download");
  });

  it("puts a name starting with the query first, and lists everything for no query", () => {
    expect(first("High")).toBe("tool:highlight");
    expect(search(all, "  ")).toHaveLength(all.length);
    expect(search(all, "zzzz")).toEqual([]);
  });
});
