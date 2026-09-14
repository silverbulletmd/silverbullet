import type { SpaceInfo } from "./types.ts";

export const SPACE_SECTIONS = {
  general: "General",
  access: "Access",
  revisions: "Revisions",
  advanced: "Advanced",
} as const;

export type SpaceSection = keyof typeof SPACE_SECTIONS;

const SECTION_FIELDS = {
  general: ["name", "binding", "folder", "indexPage"],
  access: ["access", "members", "readOnly"],
  revisions: ["revisions", "revisionsCommit"],
  advanced: ["shell"],
} as const;

export function settingsPayload(
  values: Partial<SpaceInfo>,
  section: SpaceSection,
): Partial<SpaceInfo> {
  return Object.fromEntries(
    SECTION_FIELDS[section].map((key) => [key, values[key]]),
  );
}

export function applySpacePatch(
  space: SpaceInfo,
  patch: Partial<SpaceInfo>,
): SpaceInfo {
  return {
    ...space,
    ...patch,
    bindingWarning: patch.binding ? undefined : space.bindingWarning,
  };
}
