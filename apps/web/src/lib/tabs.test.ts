import { beforeEach, describe, expect, it } from "vitest";
import { closeTab, MAX_TABS, openTab, readTabs, tabsSnapshot, withTab } from "./tabs";

beforeEach(() => {
  const data = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k), clear: () => data.clear(), key: () => null, length: 0,
  } as Storage;
});

describe("document tabs", () => {
  it("adds a document once, at the end, and keeps its name up to date", () => {
    openTab({ id: "a", name: "a.pdf" });
    openTab({ id: "b", name: "b.pdf" });
    openTab({ id: "a", name: "surat.pdf" });
    expect(readTabs()).toEqual([{ id: "a", name: "surat.pdf" }, { id: "b", name: "b.pdf" }]);
  });

  it("keeps at most MAX_TABS, dropping the oldest", () => {
    let list = Array.from({ length: MAX_TABS }, (_, i) => ({ id: `d${i}`, name: `${i}.pdf` }));
    list = withTab(list, { id: "new", name: "new.pdf" });
    expect(list).toHaveLength(MAX_TABS);
    expect(list[0].id).toBe("d1");
    expect(list.at(-1)!.id).toBe("new");
  });

  it("closing the shown tab goes to its right neighbour, else its left one, else nowhere", () => {
    ["a", "b", "c"].forEach((id) => openTab({ id, name: id }));
    expect(closeTab("b")?.id).toBe("c");
    expect(closeTab("c")?.id).toBe("a");
    expect(closeTab("a")).toBeNull();
    expect(readTabs()).toEqual([]);
  });

  it("gives the same snapshot until the row changes", () => {
    openTab({ id: "a", name: "a" });
    const s = tabsSnapshot();
    expect(tabsSnapshot()).toBe(s);
    openTab({ id: "b", name: "b" });
    expect(tabsSnapshot()).not.toBe(s);
  });
});
