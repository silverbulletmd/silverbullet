import { persistConfigValue } from "../../config_management/config_page.ts";
import type { Config } from "../../config.ts";

export const PINNED_TAGS_PATH = "workbench.pinnedTags";

export function pinnedTags(config: Config): string[] {
  const pins = config.get<unknown>(PINNED_TAGS_PATH, []);
  return Array.isArray(pins)
    ? pins.filter((t): t is string => typeof t === "string")
    : [];
}

export function togglePin(pinned: string[], tag: string): string[] {
  return pinned.includes(tag)
    ? pinned.filter((t) => t !== tag)
    : [...pinned, tag];
}

export function savePins(pins: string[]): Promise<void> {
  return persistConfigValue(PINNED_TAGS_PATH, pins);
}
