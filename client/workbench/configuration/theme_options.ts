import {
  resolveTheme,
  type ThemeInfo,
} from "@silverbulletmd/silverbullet/lib/themes";

export const UNSET_THEME_LABEL = "Default (follows system)";

function byName(a: ThemeInfo, b: ThemeInfo): number {
  return a.displayName.localeCompare(b.displayName);
}

/** Themes split by scheme, each sorted by display name. */
export function themeGroups(themes: ThemeInfo[]): {
  light: ThemeInfo[];
  dark: ThemeInfo[];
} {
  return {
    light: themes.filter((t) => t.scheme === "light").sort(byName),
    dark: themes.filter((t) => t.scheme === "dark").sort(byName),
  };
}

/** The hint under the dropdown while this device overrides the space theme; undefined without an override. */
export function deviceThemeNote(
  override: string | undefined,
  themes: ThemeInfo[],
  previewing: boolean,
): string | undefined {
  if (override === undefined) return undefined;
  const name =
    themes.find((t) => t.page === override)?.displayName ??
    override.split("/").pop();
  return `This device uses ${name}${previewing ? " and returns to it after saving" : ""}`;
}

/** A leading option for a set theme that isn't installed, so the select doesn't show a blank. */
export function missingThemeOption(
  value: string | undefined,
  themes: ThemeInfo[],
): { value: string; label: string } | undefined {
  if (!value || themes.some((t) => t.page === value)) return undefined;
  return { value, label: `${value.split("/").pop()} (not installed)` };
}

/** The theme page to preview, or undefined to show the real one: a hidden tab or an unchanged value previews nothing, and unset follows the system. */
export function previewPage(
  showing: boolean,
  value: string | undefined,
  saved: string | undefined,
  themes: ThemeInfo[],
  prefersDark: boolean,
): string | undefined {
  if (!showing || value === saved) return undefined;
  return value ?? resolveTheme({ prefersDark }, themes).theme.page;
}
