import { isNarrowScreen } from "../../lib/mobile.ts";
import { currentLayoutDefaults } from "../../navigator/navigator.ts";
import { WINDOW_DOCKS } from "../../navigator/types.ts";
import { normalizeViewDefaults } from "../../navigator/view_defaults.ts";
import type { ConfigurationModel } from "./configuration_model.ts";

export const LAYOUT_PATH = "view.defaults";

const SLOT_LABELS = { lhs: "Left", rhs: "Right", bhs: "Bottom" } as const;

export type SlotSummary = {
  slot: (typeof WINDOW_DOCKS)[number];
  label: (typeof SLOT_LABELS)[keyof typeof SLOT_LABELS];
  text: string;
};

/** What each window dock shows to someone opening the space fresh. */
export function layoutSummary(
  value: unknown,
  dockOf: (name: string) => string | undefined,
  titleOf: (name: string) => string,
): SlotSummary[] {
  const defaults = normalizeViewDefaults(value);
  return WINDOW_DOCKS.map((slot) => {
    const views: string[] = [];
    for (const [name, entry] of Object.entries(defaults)) {
      if (entry.open !== true) continue;
      if ((entry.dock ?? dockOf(name)) !== slot) continue;
      const size = slot === "bhs" ? entry.height : entry.width;
      views.push(
        size === undefined ? titleOf(name) : `${titleOf(name)} (${size}px)`,
      );
    }
    return {
      slot,
      label: SLOT_LABELS[slot],
      text: views.length > 0 ? views.join(", ") : "—",
    };
  });
}

/**
 * Saves the views docked right now as the space's default layout. A narrow
 * screen shows panels as drawers, so there is no layout to capture there.
 * Throws when it could not be saved.
 */
export async function saveCurrentLayout(
  model: ConfigurationModel,
  deps: {
    narrow?: () => boolean;
    snapshot?: (existing: unknown) => Promise<unknown>;
  } = {},
): Promise<"saved" | "narrow"> {
  const narrow = deps.narrow ?? isNarrowScreen;
  const snapshot = deps.snapshot ?? currentLayoutDefaults;
  if (narrow()) return "narrow";
  await model.commitNow(LAYOUT_PATH, snapshot);
  return "saved";
}
