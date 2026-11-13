import { EDITOR_SIZE_RANGE, type ThemeFonts } from "./fonts.ts";
import { normalizeTagList } from "./tags.ts";

export type { ThemeFonts };

export type ThemeScheme = "light" | "dark";

export type ThemeInfo = {
  page: string;
  displayName: string;
  description?: string;
  scheme: ThemeScheme;
  counterpart?: string;
  fonts?: ThemeFonts;
};

export const THEME_TAG = "meta/theme";
export const BUILTIN_LIGHT_THEME = "Library/Std/Themes/SilverBullet Light";
export const BUILTIN_DARK_THEME = "Library/Std/Themes/SilverBullet Dark";

function str(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function themeFonts(raw: unknown): ThemeFonts | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }
  const f = raw as Record<string, unknown>;
  const fonts: ThemeFonts = {};
  for (const key of ["ui", "editor", "code"] as const) {
    const v = str(f[key]);
    if (v !== undefined) fonts[key] = v;
  }
  if (
    typeof f.editorSize === "number" &&
    f.editorSize >= EDITOR_SIZE_RANGE.min &&
    f.editorSize <= EDITOR_SIZE_RANGE.max
  ) {
    fonts.editorSize = f.editorSize;
  }
  return Object.keys(fonts).length > 0 ? fonts : undefined;
}

/**
 * The ThemeInfo for a `meta/theme` page with a valid `scheme`; `"invalid"`
 * for one tagged as a theme without it; undefined for any other page.
 */
export function themeInfoFromFrontmatter(
  page: string,
  fm: Record<string, unknown>,
): ThemeInfo | "invalid" | undefined {
  if (!normalizeTagList(fm.tags).includes(THEME_TAG)) {
    return undefined;
  }
  if (fm.scheme !== "light" && fm.scheme !== "dark") {
    return "invalid";
  }
  const counterpart = str(fm.counterpart)
    ?.trim()
    .replace(/^\[\[(.*?)(\|.*)?\]\]$/, "$1");
  const description = str(fm.description);
  const fonts = themeFonts(fm.fonts);
  return {
    page,
    displayName: str(fm.displayName) ?? page.split("/").pop()!,
    ...(description ? { description } : {}),
    scheme: fm.scheme,
    ...(counterpart ? { counterpart } : {}),
    ...(fonts ? { fonts } : {}),
  };
}

export type ThemeChoice = {
  device?: string;
  space?: string;
  prefersDark: boolean;
};

/** The part of a tooling block that `themeCss` needs: the page it is on. */
type ThemeBlock = { page: string; code: string };

/**
 * The device override, else the space theme, else (`fallback`) the built-in
 * matching the OS scheme.
 */
export function resolveTheme(
  choice: ThemeChoice,
  themes: ThemeInfo[],
): { theme: ThemeInfo; fallback: boolean } {
  for (const page of [choice.device, choice.space]) {
    const found = page ? themes.find((t) => t.page === page) : undefined;
    if (found) return { theme: found, fallback: false };
  }
  const page = choice.prefersDark ? BUILTIN_DARK_THEME : BUILTIN_LIGHT_THEME;
  const theme = themes.find((t) => t.page === page) ?? {
    page,
    displayName: choice.prefersDark
      ? "SilverBullet Dark"
      : "SilverBullet Light",
    scheme: choice.prefersDark ? "dark" : "light",
  };
  return { theme, fallback: true };
}

/** `active`'s counterpart theme, when it names one that is installed. */
export function counterpartTheme(
  active: ThemeInfo,
  themes: ThemeInfo[],
): ThemeInfo | undefined {
  return active.counterpart
    ? themes.find((t) => t.page === active.counterpart)
    : undefined;
}

/** The blocks `themeCss` applies for `active`, in order: the built-in theme for the scheme first (unless active is it), then the active theme. */
export function themeBlocks<B extends ThemeBlock>(
  active: ThemeInfo,
  themeStyles: B[],
): B[] {
  const builtin =
    active.scheme === "dark" ? BUILTIN_DARK_THEME : BUILTIN_LIGHT_THEME;
  const pages =
    active.page === builtin ? [active.page] : [builtin, active.page];
  return pages.flatMap((page) => themeStyles.filter((b) => b.page === page));
}

/**
 * The `accentColor` setting as a `<style>` that follows the theme's blocks, or
 * "" when unset or not a plain color value (it lands inside a stylesheet).
 */
export function accentCss(color: string | undefined): string {
  const value = color?.trim();
  if (!value || /[;{}<>\\]/.test(value)) return "";
  if (typeof CSS !== "undefined" && !CSS.supports("color", value)) return "";
  return `<style data-sb-accent>html{--ui-accent-color:${value};}</style>`;
}

/** One `<style>` element per block of `themeBlocks`. */
export function themeCss(active: ThemeInfo, themeStyles: ThemeBlock[]): string {
  return themeBlocks(active, themeStyles)
    .map((b) => `<style>${b.code}</style>`)
    .join("");
}

/** Maps the old dark-mode flag to a theme page, unless the space theme already agrees. */
export function migrateDarkMode(
  darkMode: boolean | undefined,
  spaceTheme: ThemeInfo | undefined,
): string | undefined {
  if (darkMode === true) {
    return spaceTheme?.scheme === "dark" ? undefined : BUILTIN_DARK_THEME;
  }
  if (darkMode === false) {
    return spaceTheme?.scheme === "light" ? undefined : BUILTIN_LIGHT_THEME;
  }
  return undefined;
}

/**
 * A theme as shown: its info and its `<style>` elements. Also the boot cache,
 * so a boot before the theme list arrives has the real name and fonts.
 */
export type CachedTheme = {
  theme: ThemeInfo;
  css: string;
  /** Nothing chose it: the built-in for the system's scheme. */
  fallback?: true;
};

/** The container of the active theme's `<style>` elements, between `#sb-fonts` and `#custom-styles`. */
export const THEME_STYLE_ID = "sb-theme";

export function themeCacheKey(baseURI: string): string {
  return `silverbullet.${baseURI}.theme`;
}
