import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { entryText, pickerFamilies, pickerGroups, type PickerManifest } from "./fontPicker";

const small: PickerManifest = {
  common: ["Tinos", "Arimo", "Missing"],
  families: {
    Arimo: { category: "sans", display: "Arial" },
    Tinos: { category: "serif", display: "Times New Roman" },
    Lato: { category: "sans" },
    Inter: { category: "sans" },
    Gelasio: { category: "serif", display: "Georgia" },
    Caveat: { category: "script" },
  },
};

describe("pickerGroups", () => {
  it("puts the document fonts first, under their familiar names, then one group per design", () => {
    const groups = pickerGroups(small);
    expect(groups.map((g) => g.id)).toEqual(["common", "sans", "serif", "script"]); // no mono family: no mono group
    expect(groups[0].entries.map((e) => entryText(e))).toEqual(["Times New Roman · Tinos", "Arial · Arimo"]);
    expect(groups[1].entries.map((e) => entryText(e))).toEqual(["Inter", "Lato"]);
    expect(groups[2].entries.map((e) => entryText(e))).toEqual(["Georgia · Gelasio"]); // not in `common`: shown in its group
  });

  it("stores the family id, never the familiar name, and lists a family once", () => {
    const groups = pickerGroups(small);
    expect(groups[0].entries.map((e) => e.family)).toEqual(["Tinos", "Arimo"]);
    const all = pickerFamilies(groups);
    expect(new Set(all).size).toBe(all.length);
    expect(all.sort()).toEqual(Object.keys(small.families).sort());
  });

  it("works without a `common` list (an older manifest) and sorts by the shown name", () => {
    const groups = pickerGroups({ families: { B: { category: "sans", display: "Alpha" }, A: { category: "sans" } } });
    expect(groups.map((g) => g.id)).toEqual(["sans"]);
    expect(groups[0].entries.map((e) => e.label)).toEqual(["A", "Alpha"]);
  });

  it("shows a family whose display equals its id once", () => {
    const [group] = pickerGroups({ families: { Inter: { category: "sans", display: "Inter" } } });
    expect(entryText(group.entries[0])).toBe("Inter");
  });
});

describe("the bundled manifest", () => {
  const manifest = JSON.parse(readFileSync(path.join(__dirname, "../../../../packages/fonts/manifest.json"), "utf8")) as PickerManifest;

  it("leads with Times New Roman and Arial, and keeps every family reachable", () => {
    const groups = pickerGroups(manifest);
    expect(groups[0].id).toBe("common");
    expect(groups[0].entries.slice(0, 2).map((e) => entryText(e))).toEqual(["Times New Roman · Tinos", "Arial · Arimo"]);
    const texts = groups[0].entries.map((e) => e.label);
    for (const name of ["Calibri", "Cambria", "Courier New", "Georgia", "Verdana", "Tahoma", "Palatino / Book Antiqua"]) expect(texts).toContain(name);
    expect(pickerFamilies(groups).sort()).toEqual(Object.keys(manifest.families).sort());
    // Ids that ops of existing drafts reference are still the stored values.
    expect(pickerFamilies(groups)).toEqual(expect.arrayContaining(["Arimo", "Tinos", "Cousine", "Carlito", "Caladea", "Inter", "Lato"]));
  });
});
