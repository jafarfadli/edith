import presets from "@edith/ops/stamp-presets.json";

export interface StampPreset { id: string; label: string; color: string }

/** The shared preset table (packages/ops/stamp-presets.json, also read by the API): 17 English then the 17 Indonesian equivalents. */
export const STAMP_PRESETS: StampPreset[] = presets;
export const STAMPS_EN: StampPreset[] = STAMP_PRESETS.slice(0, 17);
export const STAMPS_ID: StampPreset[] = STAMP_PRESETS.slice(17);
