/** The font picker's list, built from the font manifest (packages/fonts/manifest.json).
 *
 *  A family keeps its stable id ("Tinos"): that is what a text run stores and what the API bakes, so old drafts
 *  load unchanged. The manifest's `display` is only a label: the picker shows the familiar document name first
 *  ("Times New Roman") with the id after it as the substitute actually used ("Times New Roman · Tinos"). */

export type PickerGroupId = "common" | "sans" | "serif" | "mono" | "script";

/** The part of the manifest the picker reads. */
export interface PickerManifest {
  families: Record<string, { category: string; display?: string }>;
  /** Ids of the document fonts, listed first and in this order. */
  common?: string[];
}

export interface PickerEntry {
  /** The stored family id (the option's value). */
  family: string;
  /** The familiar name, or the id for a family without one. */
  label: string;
  /** The id when `label` is a familiar name, else null. */
  substitute: string | null;
}

export interface PickerGroup { id: PickerGroupId; entries: PickerEntry[] }

const CATEGORIES: PickerGroupId[] = ["sans", "serif", "mono", "script"];

function entry(manifest: PickerManifest, family: string): PickerEntry {
  const display = manifest.families[family].display;
  return display && display !== family ? { family, label: display, substitute: family } : { family, label: family, substitute: null };
}

/** The text of an option: "Times New Roman · Tinos", or just the id. */
export function entryText(e: PickerEntry): string {
  return e.substitute ? `${e.label} · ${e.substitute}` : e.label;
}

/** Document fonts first (manifest order), then one group per category, alphabetical by shown name, without the
 *  families already listed on top; empty groups are left out. */
export function pickerGroups(manifest: PickerManifest): PickerGroup[] {
  const common = [...new Set(manifest.common ?? [])].filter((f) => manifest.families[f]);
  const onTop = new Set(common);
  const groups: PickerGroup[] = [{ id: "common", entries: common.map((f) => entry(manifest, f)) }];
  for (const id of CATEGORIES) {
    const entries = Object.keys(manifest.families)
      .filter((f) => manifest.families[f].category === id && !onTop.has(f))
      .map((f) => entry(manifest, f))
      .sort((a, b) => a.label.localeCompare(b.label, "en"));
    groups.push({ id, entries });
  }
  return groups.filter((g) => g.entries.length > 0);
}

/** Every family id of the groups, in picker order. */
export function pickerFamilies(groups: PickerGroup[]): string[] {
  return groups.flatMap((g) => g.entries.map((e) => e.family));
}
