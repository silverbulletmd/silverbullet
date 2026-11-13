// @vitest-environment happy-dom
import {
  BUILTIN_DARK_THEME,
  BUILTIN_LIGHT_THEME,
  type CachedTheme,
  type ThemeInfo,
  themeCacheKey,
} from "@silverbulletmd/silverbullet/lib/themes";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Client } from "./client.ts";
import {
  APPLY_THEME_JS,
  applyCachedTheme,
  applyThemeMessage,
  applyThemeToDocument,
  reportTitlebarColors,
  SpaceTheme,
  type SpaceThemeDeps,
  THEME_STYLE_ID,
} from "./space_theme.ts";
import type { ToolBlock } from "./tooling.ts";

const light: ThemeInfo = {
  page: BUILTIN_LIGHT_THEME,
  displayName: "SilverBullet Light",
  scheme: "light",
};
const dark: ThemeInfo = {
  page: BUILTIN_DARK_THEME,
  displayName: "SilverBullet Dark",
  scheme: "dark",
};
const paper: ThemeInfo = {
  page: "Library/Paper/Night",
  displayName: "Paper Night",
  scheme: "dark",
};

function block(page: string, code: string): ToolBlock {
  return { ref: `${page}@1`, page, pos: 1, code, priority: 0, boot: false };
}

const themeStyles = [
  block(BUILTIN_DARK_THEME, "html{--root-color:#eee}"),
  block(paper.page, "html{--root-color:#fed}"),
];
const paperCss =
  "<style>html{--root-color:#eee}</style><style>html{--root-color:#fed}</style>";

/** A stand-in for `matchMedia("(prefers-color-scheme: dark)")`. */
function fakeMediaQuery(initial: boolean) {
  const listeners = new Set<() => void>();
  const mq = {
    matches: initial,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    change(matches: boolean) {
      mq.matches = matches;
      for (const fn of [...listeners]) fn();
    },
    listenerCount: () => listeners.size,
  };
  return mq;
}

type Tooling = { themes: ThemeInfo[]; themeStyles: ToolBlock[] };

function stubDeps(opts: {
  device?: string;
  space?: string;
  accent?: string;
  oldDarkMode?: unknown;
  tooling?: Tooling | undefined;
  configLoaded?: boolean;
}) {
  const settings: Record<string, unknown> = {
    theme: opts.space,
    accentColor: opts.accent,
  };
  const store = new Map<string, unknown>();
  if (opts.device !== undefined) store.set("client/theme", opts.device);
  if (opts.oldDarkMode !== undefined) {
    store.set("client/darkMode", opts.oldDarkMode);
  }
  const deps = {
    ds: {
      get: vi.fn(async (key: string[]) => store.get(key.join("/"))),
      set: vi.fn(async (key: string[], v: unknown) => {
        store.set(key.join("/"), v);
      }),
      delete: vi.fn(async (key: string[]) => {
        store.delete(key.join("/"));
      }),
    },
    config: {
      get: <T>(key: string | string[], def: T): T =>
        (settings[String(key)] as T) ?? def,
    },
    bootConfig: {} as { disableSpaceStyle?: boolean },
    // An explicit `tooling: undefined` means none, not the default
    tooling:
      "tooling" in opts
        ? opts.tooling
        : { themes: [light, dark, paper], themeStyles },
    configLoaded: opts.configLoaded ?? false,
  };
  return {
    deps: deps as SpaceThemeDeps & typeof deps,
    settings,
    store,
    device: () => store.get("client/theme"),
  };
}

const cached = (theme: ThemeInfo, css = "", fallback?: true): CachedTheme => ({
  theme,
  css,
  ...(fallback ? { fallback } : {}),
});

function setupDocument() {
  document.head.innerHTML = "";
  document.body.innerHTML = `<style id="sb-fonts"></style><div id="${THEME_STYLE_ID}"></div><div id="custom-styles"></div>`;
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-sb-scheme");
  document.documentElement.removeAttribute("data-sb-theme");
  document.documentElement.style.colorScheme = "";
}

const cacheKey = () => themeCacheKey(document.baseURI);
const themeContainer = () => document.getElementById(THEME_STYLE_ID)!;
let media: ReturnType<typeof fakeMediaQuery>;

beforeEach(() => {
  setupDocument();
  localStorage.clear();
  media = fakeMediaQuery(false);
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => media),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("applyThemeToDocument", () => {
  const paperCached = cached(paper, "<style>html{--root-color:#fed}</style>");

  test("fills #sb-theme and sets the html attributes", () => {
    applyThemeToDocument(paperCached);
    const html = document.documentElement;
    expect(html.dataset.theme).toBe("dark");
    expect(html.dataset.sbScheme).toBe("dark");
    expect(html.dataset.sbTheme).toBe(paper.page);
    expect(html.style.colorScheme).toBe("dark");
    expect(themeContainer().innerHTML).toBe(paperCached.css);
  });

  test("points every theme-color meta at the theme, dropping their media queries", () => {
    document.head.innerHTML = `
      <meta name="theme-color" content="#e1e1e1" media="(prefers-color-scheme: light)">
      <meta name="theme-color" content="#262626" media="(prefers-color-scheme: dark)">`;
    applyThemeToDocument({
      ...paperCached,
      css: "<style>html{--top-background-color:#123456}</style>",
    });
    const metas = [...document.querySelectorAll('meta[name="theme-color"]')];
    expect(metas).toHaveLength(2);
    for (const meta of metas) {
      expect(meta.hasAttribute("media")).toBe(false);
      expect(meta.getAttribute("content")).toBe("#123456");
    }
  });
});

describe("APPLY_THEME_JS", () => {
  test("is applyThemeMessage, runnable on its own as iframe scripts inline it", () => {
    const frame = document.implementation.createHTMLDocument();
    frame.body.innerHTML = `<div id="${THEME_STYLE_ID}" hidden></div>`;
    const applyTheme = new Function(
      "document",
      `${APPLY_THEME_JS} return sbApplyTheme;`,
    )(frame);
    applyTheme({ scheme: "dark", page: paper.page, css: "<style>p{}</style>" });
    const html = frame.documentElement;
    expect(html.dataset.sbScheme).toBe("dark");
    expect(html.dataset.theme).toBe("dark");
    expect(html.dataset.sbTheme).toBe(paper.page);
    expect(frame.getElementById(THEME_STYLE_ID)!.innerHTML).toBe(
      "<style>p{}</style>",
    );
  });

  test("leaves HTML without a theme container, and messages without a scheme, alone", () => {
    const frame = document.implementation.createHTMLDocument();
    applyThemeMessage({ scheme: "dark", css: "<style>p{}</style>" }, frame);
    expect(frame.documentElement.dataset.sbScheme).toBe("dark");
    expect(frame.body.innerHTML).toBe("");
    applyThemeMessage(undefined, frame);
    expect(frame.documentElement.dataset.sbScheme).toBe("dark");
  });
});

describe("reportTitlebarColors", () => {
  test("hands Desktop the top bar colours and scheme, once per change", () => {
    const setTitlebarColors = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("silverbulletDesktop", { setTitlebarColors });
    applyThemeToDocument(
      cached(
        paper,
        "<style>html{--top-background-color:#123456;--top-color:#abcdef}</style>",
      ),
    );
    reportTitlebarColors("dark");
    reportTitlebarColors("dark");
    expect(setTitlebarColors).toHaveBeenCalledTimes(1);
    expect(setTitlebarColors).toHaveBeenCalledWith({
      background: "#123456",
      symbol: "#abcdef",
      scheme: "dark",
    });
  });

  test("does nothing without the Desktop bridge", () => {
    expect(() => reportTitlebarColors("light")).not.toThrow();
  });
});

describe("applyCachedTheme", () => {
  test("applies the cached theme and returns it", () => {
    const entry = cached(dark, "<style></style>");
    localStorage.setItem(cacheKey(), JSON.stringify(entry));
    expect(applyCachedTheme()).toEqual(entry);
    expect(document.documentElement.dataset.sbTheme).toBe(dark.page);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.sbScheme).toBe("dark");
  });

  test("does nothing without a cache, with bad JSON or an old shape, or without storage", () => {
    expect(applyCachedTheme()).toBeUndefined();
    localStorage.setItem(cacheKey(), "{not json");
    expect(applyCachedTheme()).toBeUndefined();
    // The shape before `theme` held the ThemeInfo
    localStorage.setItem(
      cacheKey(),
      JSON.stringify({ page: dark.page, scheme: "dark", css: "" }),
    );
    expect(applyCachedTheme()).toBeUndefined();
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
    });
    expect(applyCachedTheme()).toBeUndefined();
    expect(themeContainer().innerHTML).toBe("");
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(document.documentElement.dataset.sbScheme).toBeUndefined();
  });
});

test("safe mode (?disableSpaceStyle) boots without the cached theme", () => {
  const before = location.href;
  history.replaceState(null, "", "?disableSpaceStyle=1");
  try {
    localStorage.setItem(cacheKey(), JSON.stringify(cached(paper)));
    expect(applyCachedTheme()).toBeUndefined();
    expect(document.documentElement.dataset.sbTheme).toBeUndefined();
  } finally {
    history.replaceState(null, "", before);
  }
});

describe("SpaceTheme", () => {
  test("the device override wins over the space setting, and is cached", async () => {
    const { deps } = stubDeps({ device: paper.page, space: light.page });
    const theme = new SpaceTheme(deps);
    expect(await theme.apply()).toEqual(paper);
    expect(theme.active).toEqual(paper);
    expect(theme.scheme).toBe("dark");
    expect(document.documentElement.dataset.sbTheme).toBe(paper.page);
    // SilverBullet Dark underneath, then the theme itself
    expect(themeContainer().innerHTML).toBe(paperCss);
    expect(theme.message).toEqual({
      scheme: "dark",
      page: paper.page,
      css: paperCss,
    });
    expect(JSON.parse(localStorage.getItem(cacheKey())!)).toEqual(
      cached(paper, paperCss),
    );
  });

  test("the scheme is the boot cache's until the first apply, else light", async () => {
    expect(new SpaceTheme(stubDeps({}).deps).scheme).toBe("light");
    const theme = new SpaceTheme(stubDeps({}).deps, cached(paper));
    expect(theme.scheme).toBe("dark");
    expect(theme.active).toEqual(paper);
    await theme.apply();
    expect(theme.scheme).toBe("light");
  });

  test("an apply that resolves to what the boot cache shows doesn't redo it", async () => {
    const { deps } = stubDeps({ space: paper.page });
    const boot = cached(paper, paperCss);
    applyThemeToDocument(boot);
    const theme = new SpaceTheme(deps, boot);
    const seen: string[] = [];
    theme.onChange((t) => seen.push(t.page));
    await theme.apply();
    expect(seen).toEqual([]);
    expect(themeContainer().innerHTML).toBe(paperCss);
  });

  test("on the fallback, follows the system scheme when it changes", async () => {
    const theme = new SpaceTheme(stubDeps({}).deps);
    expect((await theme.apply()).page).toBe(BUILTIN_LIGHT_THEME);
    media.change(true);
    await vi.waitFor(() => expect(theme.active?.page).toBe(BUILTIN_DARK_THEME));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.sbScheme).toBe("dark");
  });

  test("with a space theme, ignores system scheme changes", async () => {
    const theme = new SpaceTheme(stubDeps({ space: light.page }).deps);
    await theme.apply();
    expect(media.listenerCount()).toBe(0);
    media.change(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(theme.active?.page).toBe(BUILTIN_LIGHT_THEME);
  });

  test("leaving the fallback for a space theme stops following the system", async () => {
    const { deps, settings } = stubDeps({});
    const theme = new SpaceTheme(deps);
    await theme.apply();
    expect(media.listenerCount()).toBe(1);
    settings.theme = light.page;
    await theme.apply();
    expect(media.listenerCount()).toBe(0);
  });

  test("onChange hears a switch, and stops hearing after unsubscribing", async () => {
    const theme = new SpaceTheme(stubDeps({}).deps);
    const seen: string[] = [];
    const off = theme.onChange((t) => seen.push(t.page));
    await theme.apply();
    await theme.apply();
    theme.preview({ page: paper.page });
    off();
    theme.preview({ page: undefined });
    expect(seen).toEqual([BUILTIN_LIGHT_THEME, paper.page]);
  });

  test("a theme preview isn't cached, and clearing it restores", async () => {
    const theme = new SpaceTheme(stubDeps({ space: light.page }).deps);
    await theme.apply();
    const cachedBefore = localStorage.getItem(cacheKey());

    theme.preview({ page: paper.page });
    expect(theme.active).toEqual(paper);
    expect(theme.previewing).toBe(true);
    expect(document.documentElement.dataset.sbTheme).toBe(paper.page);
    expect(localStorage.getItem(cacheKey())).toBe(cachedBefore);

    theme.preview({ page: undefined });
    expect(theme.previewing).toBe(false);
    expect(theme.active?.page).toBe(BUILTIN_LIGHT_THEME);
    expect(document.documentElement.dataset.sbTheme).toBe(BUILTIN_LIGHT_THEME);
    expect(themeContainer().innerHTML).toBe("");
  });

  test("two switches in a row: the html attributes end on the last theme", async () => {
    const theme = new SpaceTheme(stubDeps({ space: light.page }).deps);
    await theme.apply();
    theme.preview({ page: BUILTIN_DARK_THEME });
    theme.preview({ page: BUILTIN_LIGHT_THEME });
    const html = document.documentElement;
    expect(theme.scheme).toBe("light");
    expect(html.dataset.sbScheme).toBe("light");
    expect(html.dataset.theme).toBe("light");
    expect(html.dataset.sbTheme).toBe(BUILTIN_LIGHT_THEME);
    expect(html.style.colorScheme).toBe("light");
  });

  test("an accent preview goes over a theme preview and survives choosing another", async () => {
    const accent = (c: string) =>
      `<style data-sb-accent>html{--ui-accent-color:${c};}</style>`;
    const { deps, settings } = stubDeps({ space: paper.page, accent: "red" });
    const theme = new SpaceTheme(deps);
    await theme.apply();
    expect(theme.message.css).toBe(paperCss + accent("red"));

    theme.preview({ accent: "blue" });
    expect(theme.previewing).toBe(false);
    expect(
      themeContainer().querySelector("style[data-sb-accent]")!.textContent,
    ).toBe("html{--ui-accent-color:blue;}");
    theme.preview({ page: BUILTIN_DARK_THEME });
    expect(theme.message.css).toBe(
      `<style>html{--root-color:#eee}</style>${accent("blue")}`,
    );
    // A reload while previewing keeps the edit
    settings.theme = light.page;
    await theme.apply();
    expect(theme.message.css).toBe(
      `<style>html{--root-color:#eee}</style>${accent("blue")}`,
    );
    // "" previews the theme's own accent
    theme.preview({ accent: "" });
    expect(theme.message.css).toBe("<style>html{--root-color:#eee}</style>");
    theme.preview({ page: undefined, accent: undefined });
    expect(theme.message.css).toBe(accent("red"));
    expect(JSON.parse(localStorage.getItem(cacheKey())!).css).toBe(
      accent("red"),
    );
  });

  test("without tooling or a cache, falls back to a synthesized SilverBullet Light with no CSS", async () => {
    const theme = new SpaceTheme(stubDeps({ tooling: undefined }).deps);
    expect(await theme.apply()).toMatchObject({
      page: BUILTIN_LIGHT_THEME,
      scheme: "light",
    });
    expect(themeContainer().innerHTML).toBe("");
    expect(document.documentElement.dataset.sbScheme).toBe("light");
    expect(localStorage.getItem(cacheKey())).toBeNull();
  });

  test("without tooling, keeps the cached theme, its name and fonts, and leaves the cache alone", async () => {
    const inked: ThemeInfo = { ...paper, fonts: { editor: "inter" } };
    const entry = JSON.stringify(cached(inked, "<style>p{}</style>"));
    localStorage.setItem(cacheKey(), entry);
    const theme = new SpaceTheme(stubDeps({ tooling: undefined }).deps);
    expect(await theme.apply()).toEqual(inked);
    expect(themeContainer().innerHTML).toBe("<style>p{}</style>");
    expect(localStorage.getItem(cacheKey())).toBe(entry);
  });

  test("offline on a dark system, the first boot is dark: the dark palette is built in", async () => {
    media.matches = true;
    const theme = new SpaceTheme(stubDeps({ tooling: undefined }).deps);
    expect(await theme.apply()).toMatchObject({ scheme: "dark" });
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  test("a space without a theme or any theme CSS follows the system scheme, live", async () => {
    media.matches = true;
    const { deps } = stubDeps({
      tooling: { themes: [light, dark], themeStyles: [] },
      configLoaded: true,
    });
    const theme = new SpaceTheme(deps);
    expect((await theme.apply()).page).toBe(BUILTIN_DARK_THEME);
    expect(document.documentElement.dataset.sbScheme).toBe("dark");
    media.change(false);
    await vi.waitFor(() =>
      expect(document.documentElement.dataset.sbScheme).toBe("light"),
    );
    media.change(true);
    await vi.waitFor(() =>
      expect(document.documentElement.dataset.sbScheme).toBe("dark"),
    );
  });

  test("before Space Lua has run, the fallback keeps the cached theme a script may set", async () => {
    localStorage.setItem(
      cacheKey(),
      JSON.stringify(cached(paper, "<style>old</style>")),
    );
    const { deps } = stubDeps({});
    const theme = new SpaceTheme(deps);
    expect((await theme.apply()).page).toBe(paper.page);
    // The cached page, with its CSS from the current tooling
    expect(themeContainer().innerHTML).toBe(paperCss);
    expect(media.listenerCount()).toBe(0);
    // Space Lua set nothing after all: now the fallback applies
    deps.configLoaded = true;
    expect((await theme.apply()).page).toBe(BUILTIN_LIGHT_THEME);
  });

  test("before Space Lua has run, a cached fallback still follows the system", async () => {
    await new SpaceTheme(stubDeps({}).deps).apply();
    expect(JSON.parse(localStorage.getItem(cacheKey())!).fallback).toBe(true);
    media.matches = true;
    const boot = new SpaceTheme(stubDeps({}).deps);
    expect((await boot.apply()).page).toBe(BUILTIN_DARK_THEME);
  });

  test("theme-color follows a space style that recolours the top bar", async () => {
    document.head.innerHTML = `<meta name="theme-color" content="#e1e1e1">`;
    const { SpaceStyles } = await import("./space_style.ts");
    const { deps } = stubDeps({ space: light.page });
    const spaceTheme = new SpaceTheme(deps);
    await spaceTheme.apply();
    new SpaceStyles({
      ...deps,
      spaceTheme,
      tooling: {
        ...deps.tooling,
        styles: [block("Library/Mine", "html{--top-background-color:#abcdef}")],
      },
    } as unknown as Client).load();
    expect(
      document
        .querySelector('meta[name="theme-color"]')!
        .getAttribute("content"),
    ).toBe("#abcdef");
  });

  test("safe mode applies only the built-in theme for the system scheme, and caches nothing", async () => {
    const { deps } = stubDeps({ device: paper.page, space: paper.page });
    deps.bootConfig.disableSpaceStyle = true;
    media.matches = true;
    const theme = new SpaceTheme(deps);
    expect((await theme.apply()).page).toBe(BUILTIN_DARK_THEME);
    expect(themeContainer().innerHTML).toBe(
      "<style>html{--root-color:#eee}</style>",
    );
    expect(localStorage.getItem(cacheKey())).toBeNull();
  });
});

describe("device theme", () => {
  test("is stored per device and applied right away; undefined clears it", async () => {
    const { deps, device } = stubDeps({ space: light.page });
    const theme = new SpaceTheme(deps);
    await theme.setDeviceTheme(paper.page);
    expect(device()).toBe(paper.page);
    expect(await theme.deviceTheme()).toBe(paper.page);
    expect(theme.active).toEqual(paper);
    await theme.setDeviceTheme(undefined);
    expect(await theme.deviceTheme()).toBeUndefined();
    expect(theme.active).toEqual(light);
  });

  test("refuses a page no installed theme has", async () => {
    const { deps, device } = stubDeps({});
    await expect(
      new SpaceTheme(deps).setDeviceTheme("Library/Gone"),
    ).rejects.toThrow("No theme page named Library/Gone");
    expect(device()).toBeUndefined();
  });
});

// Which page the old flag maps to is `migrateDarkMode`'s (themes.test.ts)
describe("migrateDeviceDarkMode", () => {
  test("once Space Lua has run, turns the old flag into an override and drops it, once", async () => {
    const { deps, store, device } = stubDeps({
      oldDarkMode: true,
      configLoaded: true,
    });
    const theme = new SpaceTheme(deps);
    expect((await theme.apply()).page).toBe(BUILTIN_DARK_THEME);
    expect(device()).toBe(BUILTIN_DARK_THEME);
    expect(store.has("client/darkMode")).toBe(false);
    store.set("client/darkMode", false);
    await theme.apply();
    expect(store.get("client/darkMode")).toBe(false);
  });

  test("waits for Space Lua, whose space theme it compares against", async () => {
    const { deps, settings, store, device } = stubDeps({ oldDarkMode: true });
    const theme = new SpaceTheme(deps);
    await theme.apply();
    expect(store.get("client/darkMode")).toBe(true);
    settings.theme = paper.page;
    deps.configLoaded = true;
    expect((await theme.apply()).page).toBe(paper.page);
    expect(device()).toBeUndefined();
    expect(store.has("client/darkMode")).toBe(false);
  });

  test("without tooling the key is left for a later apply", async () => {
    const { deps, store } = stubDeps({
      oldDarkMode: true,
      tooling: undefined,
      configLoaded: true,
    });
    await new SpaceTheme(deps).apply();
    expect(store.get("client/darkMode")).toBe(true);
  });

  test("a non-boolean stored value is dropped without an override", async () => {
    const { deps, store, device } = stubDeps({
      oldDarkMode: "yes",
      configLoaded: true,
    });
    await new SpaceTheme(deps).apply();
    expect(device()).toBeUndefined();
    expect(store.has("client/darkMode")).toBe(false);
  });

  test("an unset key writes and deletes nothing", async () => {
    const { deps } = stubDeps({ configLoaded: true });
    await new SpaceTheme(deps).apply();
    expect(deps.ds.set.mock.calls).toEqual([]);
    expect(deps.ds.delete.mock.calls).toEqual([]);
  });
});
