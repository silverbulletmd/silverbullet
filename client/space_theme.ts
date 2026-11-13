import {
  accentCss,
  type CachedTheme,
  migrateDarkMode,
  resolveTheme,
  THEME_STYLE_ID,
  type ThemeInfo,
  type ThemeScheme,
  themeCacheKey,
  themeCss,
} from "@silverbulletmd/silverbullet/lib/themes";
import type { Config } from "./config.ts";
import type { DataStore } from "./data/datastore.ts";
import type { ToolBlock } from "./tooling.ts";

export { THEME_STYLE_ID };

const DARK_QUERY = "(prefers-color-scheme: dark)";

/** Where this device's theme override is stored. */
const DEVICE_THEME_KEY = ["client", "theme"];
/** The old per-device dark mode flag, migrated to a device theme. */
const OLD_DARK_MODE_KEY = ["client", "darkMode"];

function hex(channels: number[]): string {
  return `#${channels
    .map((c) =>
      Math.round(Math.min(255, Math.max(0, c)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/** A computed color as `#rrggbb`; `theme-color` takes few color syntaxes. */
function toHexColor(value: string): string | undefined {
  const v = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(v)) {
    return hex([...v.slice(1)].map((c) => Number.parseInt(c + c, 16)));
  }
  const rgb = v.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/);
  if (rgb) return hex(rgb.slice(1, 4).map(Number));
  // What browsers compute `color-mix(in srgb, …)` to
  const srgb = v.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  if (srgb) return hex(srgb.slice(1, 4).map((c) => Number(c) * 255));
  return undefined;
}

/** A custom property resolved to a color as `#rrggbb`; the property itself computes to its unresolved `color-mix()`. */
export function resolvedColor(
  doc: Document,
  property: "background-color" | "color",
  variable: string,
): string | undefined {
  const probe = doc.createElement("div");
  probe.style.display = "none";
  probe.style.setProperty(property, `var(${variable})`);
  doc.body.append(probe);
  const computed = doc.defaultView?.getComputedStyle(probe);
  const color =
    (property === "color" ? computed?.color : computed?.backgroundColor) ?? "";
  probe.remove();
  return toHexColor(color);
}

function topBackgroundColor(doc: Document): string | undefined {
  return resolvedColor(doc, "background-color", "--top-background-color");
}

type DesktopTitlebarBridge = {
  setTitlebarColors?: (colors: {
    background: string;
    symbol: string;
    scheme: "light" | "dark";
  }) => Promise<void>;
};

let lastTitlebarReport = "";
let warnedTitlebar = false;

/** Tells Desktop (Windows/Linux title bar overlay) what the top bar looks like now; a no-op in the browser. */
export function reportTitlebarColors(
  scheme: "light" | "dark",
  doc = document,
): void {
  const bridge = (globalThis as { silverbulletDesktop?: DesktopTitlebarBridge })
    .silverbulletDesktop;
  if (!bridge?.setTitlebarColors) return;
  const background = topBackgroundColor(doc);
  if (!background) {
    if (!warnedTitlebar) {
      warnedTitlebar = true;
      console.debug("Title bar colors not reported: top background unparsable");
    }
    return;
  }
  const symbol =
    resolvedColor(doc, "color", "--top-color") ??
    (scheme === "dark" ? "#d6d6d6" : "#4a4a4a");
  const key = `${background}|${symbol}|${scheme}`;
  if (key === lastTitlebarReport) return;
  lastTitlebarReport = key;
  Promise.resolve(
    bridge.setTitlebarColors({ background, symbol, scheme }),
  ).catch(() => {
    // A window Desktop doesn't track (headless runtime) refuses; retry on the next change
    lastTitlebarReport = "";
  });
}

/** Points the browser's `theme-color` at the top bar as the page's styles now color it. */
export function updateThemeColor(doc = document): void {
  const color = topBackgroundColor(doc);
  if (!color) return;
  for (const meta of doc.querySelectorAll('meta[name="theme-color"]')) {
    meta.removeAttribute("media");
    meta.setAttribute("content", color);
  }
}

/**
 * What an `<html>` needs to show a theme: the scheme, the theme's page and
 * its `<style>` elements. Iframes get it in their `theme` messages.
 */
export type ThemeMessage = { scheme: ThemeScheme; page?: string; css: string };

/**
 * Shows `theme` on `doc`: the scheme and page on `html`, and the CSS in its
 * `#sb-theme` container (HTML without one opted out of the space's styles).
 * Iframe scripts inline this function's source (`APPLY_THEME_JS`), so it
 * must not use anything from outside its body.
 */
export function applyThemeMessage(
  theme: ThemeMessage | undefined,
  doc: Document = document,
): void {
  if (!theme?.scheme) return;
  const html = doc.documentElement;
  html.dataset.sbScheme = theme.scheme;
  // Deprecated alias of `data-sb-scheme`, kept for existing user CSS
  html.dataset.theme = theme.scheme;
  if (theme.page) html.dataset.sbTheme = theme.page;
  html.style.colorScheme = theme.scheme;
  // THEME_STYLE_ID, spelled out: this runs inside iframes too
  const container = doc.getElementById("sb-theme");
  if (container) container.innerHTML = theme.css;
}

/**
 * Defines `sbApplyTheme(message)`, which is `applyThemeMessage`, in an iframe
 * script; prefixed, as a plug's own script shares its global scope.
 */
export const APPLY_THEME_JS = `const sbApplyTheme = ${applyThemeMessage.toString()};`;

/** Shows `theme` on `doc` (see `applyThemeMessage`) and points the browser's `theme-color` at it. */
export function applyThemeToDocument(theme: CachedTheme, doc = document): void {
  applyThemeMessage(
    { scheme: theme.theme.scheme, page: theme.theme.page, css: theme.css },
    doc,
  );
  updateThemeColor(doc);
}

function isCachedTheme(value: unknown): value is CachedTheme {
  const v = value as Partial<CachedTheme> | null;
  return (
    typeof v?.css === "string" &&
    typeof v.theme?.page === "string" &&
    typeof v.theme.displayName === "string" &&
    (v.theme.scheme === "light" || v.theme.scheme === "dark")
  );
}

/** The last run's theme; an entry in any other shape is ignored. */
function readCachedTheme(doc: Document): CachedTheme | undefined {
  try {
    const cached = JSON.parse(
      localStorage.getItem(themeCacheKey(doc.baseURI)) ?? "null",
    );
    return isCachedTheme(cached) ? cached : undefined;
  } catch {
    // No storage or a broken entry: nothing cached.
    return undefined;
  }
}

/**
 * Applies the last run's theme before config exists, so the first paint
 * already has it. Returns what it applied, for `SpaceTheme` to start from.
 */
export function applyCachedTheme(doc = document): CachedTheme | undefined {
  // Safe mode: the cached theme may be what broke styling
  if (
    new URLSearchParams(doc.location?.search ?? "").has("disableSpaceStyle")
  ) {
    return undefined;
  }
  const cached = readCachedTheme(doc);
  if (cached) applyThemeToDocument(cached, doc);
  return cached;
}

/** What `SpaceTheme` needs of the client; `Client` is one. */
export type SpaceThemeDeps = {
  readonly ds?: Pick<DataStore, "get" | "set" | "delete">;
  readonly config: Pick<Config, "get">;
  readonly bootConfig: { disableSpaceStyle?: boolean };
  readonly tooling:
    | { themes: ThemeInfo[]; themeStyles: ToolBlock[] }
    | undefined;
  /** Space Lua has run, so settings like `theme` are final. */
  readonly configLoaded: boolean;
};

/**
 * What `preview()` shows over `apply()`'s theme. `accent: ""` previews no
 * accent color (the theme's own).
 */
export type ThemePreview = { page?: string; accent?: string };

/**
 * Resolves the active theme (device override, space setting, OS fallback)
 * and keeps it applied. The one owner of the scheme: the `html` attributes
 * are its output for CSS, not something to read back.
 */
export class SpaceTheme {
  /** On screen: the boot cache's until the first `apply()`, a preview included. */
  private shown: CachedTheme | undefined;
  /** `apply()`'s last result, what a preview goes back to. */
  private resolved: CachedTheme | undefined;
  private previewed: ThemePreview = {};
  private migrated = false;
  private listeners = new Set<(t: ThemeInfo) => void>();
  private mediaQuery: MediaQueryList | undefined;
  private readonly reapply = () => {
    void this.apply().catch((e) => console.error("Could not apply theme", e));
  };

  /** `boot`: what `applyCachedTheme` put on screen, if anything. */
  constructor(
    private deps: SpaceThemeDeps,
    boot?: CachedTheme,
  ) {
    this.shown = boot;
  }

  /** The theme on screen, a preview included. */
  get active(): ThemeInfo | undefined {
    return this.shown?.theme;
  }

  /** The scheme on screen; light until a theme is. */
  get scheme(): ThemeScheme {
    return this.shown?.theme.scheme ?? "light";
  }

  /** Whether a previewed theme page is on screen instead of `apply()`'s. */
  get previewing(): boolean {
    return this.previewed.page !== undefined;
  }

  /** What an iframe needs to look like the theme on screen. */
  get message(): ThemeMessage {
    return {
      scheme: this.scheme,
      page: this.shown?.theme.page,
      css: this.shown?.css ?? "",
    };
  }

  /** Called with the new theme whenever what's on screen changes. */
  onChange(fn: (t: ThemeInfo) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  async apply(): Promise<ThemeInfo> {
    const { tooling, configLoaded } = this.deps;
    // Safe mode keeps the built-in themes: SilverBullet Dark's palette is a
    // Std page, and the space's own choice may be what broke styling
    const safeMode = !!this.deps.bootConfig.disableSpaceStyle;
    // Without tooling the theme list is empty and any resolution is a guess;
    // the last real result is a better one
    const lastRun = safeMode ? undefined : readCachedTheme(document);
    if (lastRun && !tooling) {
      this.followSystem(false);
      this.resolved = lastRun;
      this.showCurrent();
      return lastRun.theme;
    }
    if (tooling && !safeMode && configLoaded) {
      await this.migrateDeviceDarkMode();
    }
    const themes = tooling?.themes ?? [];
    const resolved = resolveTheme(
      {
        device: safeMode ? undefined : await this.deviceOverride(),
        space: safeMode ? undefined : this.setting("theme"),
        // The dark palette is built into the client CSS, so no theme CSS
        // (a fresh space, or an offline first boot) still has one
        prefersDark: this.media().matches,
      },
      themes,
    );
    // Before Space Lua has run, a `theme` set by a script outside
    // Library/Config isn't known yet; a theme chosen last run is a better
    // guess than the system's
    const kept =
      resolved.fallback && !configLoaded && lastRun && !lastRun.fallback
        ? themes.find((t) => t.page === lastRun.theme.page)
        : undefined;
    const theme = kept ?? resolved.theme;
    const fallback = resolved.fallback && !kept;
    this.followSystem(fallback);
    this.resolved = {
      theme,
      css: this.cssFor(theme, this.setting("accentColor")),
      ...(fallback ? { fallback: true } : {}),
    };
    this.showCurrent();
    // A guess (no tooling) or safe mode's stand-in must not replace the
    // space's real theme for the next boot
    if (tooling && !safeMode) {
      try {
        localStorage.setItem(
          themeCacheKey(document.baseURI),
          JSON.stringify(this.resolved),
        );
      } catch {
        // No storage: the next boot starts from the built-in light look.
      }
    }
    return theme;
  }

  /**
   * Shows a theme `page` and/or an `accent` color over `apply()`'s theme,
   * until each is cleared (set to undefined); a key left out keeps its
   * preview. Not cached.
   */
  preview(change: ThemePreview): void {
    this.previewed = { ...this.previewed, ...change };
    this.showCurrent();
  }

  /** This device's theme override, if any. */
  async deviceTheme(): Promise<string | undefined> {
    const page = await this.deps.ds?.get(DEVICE_THEME_KEY);
    return typeof page === "string" ? page : undefined;
  }

  /** Sets (or, for undefined, clears) this device's theme override and applies it right away. */
  async setDeviceTheme(page: string | undefined | null): Promise<void> {
    const { ds } = this.deps;
    if (!ds) throw new Error("This device's storage isn't ready yet");
    if (page === undefined || page === null) {
      await ds.delete(DEVICE_THEME_KEY);
    } else {
      if (!this.deps.tooling?.themes.some((t) => t.page === page)) {
        throw new Error(`No theme page named ${page}`);
      }
      await ds.set(DEVICE_THEME_KEY, page);
    }
    await this.apply();
  }

  /** One-time upgrade: the old per-device `darkMode` flag becomes a device theme override. */
  async migrateDeviceDarkMode(): Promise<void> {
    if (this.migrated) return;
    const { ds } = this.deps;
    if (!ds) return;
    try {
      const old = await ds.get(OLD_DARK_MODE_KEY);
      // Only once the key has been read: a failed read retries next apply
      this.migrated = true;
      if (old === undefined || old === null) return;
      const configured = this.setting("theme");
      const spaceTheme = (this.deps.tooling?.themes ?? []).find(
        (t) => t.page === configured,
      );
      const override = migrateDarkMode(
        typeof old === "boolean" ? old : undefined,
        spaceTheme,
      );
      if (override !== undefined) await ds.set(DEVICE_THEME_KEY, override);
      await ds.delete(OLD_DARK_MODE_KEY);
    } catch (e) {
      console.error("Could not migrate this device's dark mode setting", e);
    }
  }

  /** `apply()`'s theme with the previews over it. */
  private showCurrent(): void {
    const { page, accent } = this.previewed;
    if (page === undefined && accent === undefined) {
      if (this.resolved) this.show(this.resolved);
      return;
    }
    const theme =
      page === undefined
        ? this.resolved?.theme
        : resolveTheme(
            { device: page, prefersDark: this.media().matches },
            this.deps.tooling?.themes ?? [],
          ).theme;
    if (!theme) return;
    this.show({
      theme,
      css: this.cssFor(theme, accent ?? this.setting("accentColor")),
    });
  }

  private show(next: CachedTheme): void {
    const prev = this.shown;
    this.shown = next;
    // The boot cache usually already shows this; rewriting it would only
    // make the browser re-parse the same sheets
    const changed =
      prev?.theme.page !== next.theme.page ||
      prev.theme.scheme !== next.theme.scheme ||
      prev.css !== next.css;
    if (changed) {
      applyThemeToDocument(next);
    } else {
      updateThemeColor();
    }
    reportTitlebarColors(next.theme.scheme);
    if (changed) {
      for (const fn of this.listeners) fn(next.theme);
    }
  }

  private cssFor(theme: ThemeInfo, accent: string | undefined): string {
    return (
      themeCss(theme, this.deps.tooling?.themeStyles ?? []) + accentCss(accent)
    );
  }

  private async deviceOverride(): Promise<string | undefined> {
    try {
      return await this.deviceTheme();
    } catch (e) {
      console.error("Could not read this device's theme", e);
      return undefined;
    }
  }

  private setting(key: "theme" | "accentColor"): string | undefined {
    const value = this.deps.config.get<unknown>(key, undefined);
    return typeof value === "string" ? value : undefined;
  }

  private media(): MediaQueryList {
    this.mediaQuery ??= globalThis.matchMedia(DARK_QUERY);
    return this.mediaQuery;
  }

  private followSystem(follow: boolean): void {
    // Removing first keeps repeated applies from stacking listeners
    this.media().removeEventListener("change", this.reapply);
    if (follow) this.media().addEventListener("change", this.reapply);
  }
}
