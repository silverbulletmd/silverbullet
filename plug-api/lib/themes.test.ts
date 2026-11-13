import { describe, expect, it } from "vitest";
import {
  accentCss,
  BUILTIN_DARK_THEME,
  BUILTIN_LIGHT_THEME,
  counterpartTheme,
  migrateDarkMode,
  resolveTheme,
  type ThemeInfo,
  themeCss,
  themeInfoFromFrontmatter,
} from "./themes.ts";

describe("themeInfoFromFrontmatter", () => {
  const page = "Library/x/Paper/Night";

  it("builds a ThemeInfo and normalizes the counterpart", () => {
    expect(
      themeInfoFromFrontmatter(page, {
        tags: "meta/theme",
        scheme: "dark",
        counterpart: "[[Library/x/Paper/Light]]",
      }),
    ).toEqual({
      page,
      displayName: "Night",
      scheme: "dark",
      counterpart: "Library/x/Paper/Light",
    });
  });

  it("accepts a plain page path counterpart and displayName/description", () => {
    expect(
      themeInfoFromFrontmatter(page, {
        tags: ["meta/theme"],
        scheme: "light",
        displayName: "Paper Night",
        description: "Dim paper",
        counterpart: "Library/x/Paper/Light",
      }),
    ).toEqual({
      page,
      displayName: "Paper Night",
      description: "Dim paper",
      scheme: "light",
      counterpart: "Library/x/Paper/Light",
    });
  });

  it("is invalid for a theme without a valid scheme, undefined without the tag", () => {
    expect(themeInfoFromFrontmatter(page, { tags: "meta/theme" })).toBe(
      "invalid",
    );
    expect(
      themeInfoFromFrontmatter(page, { tags: "meta/theme", scheme: "sepia" }),
    ).toBe("invalid");
    expect(themeInfoFromFrontmatter(page, { scheme: "dark" })).toBe(undefined);
  });

  it("keeps string fonts and a numeric editorSize only", () => {
    const fontsOf = (fonts: unknown) =>
      (
        themeInfoFromFrontmatter(page, {
          tags: "meta/theme",
          scheme: "dark",
          fonts,
        }) as ThemeInfo
      ).fonts;
    expect(fontsOf({ editor: "lora", editorSize: "20" })).toEqual({
      editor: "lora",
    });
    expect(fontsOf({ ui: "inter", code: 5, editorSize: 20 })).toEqual({
      ui: "inter",
      editorSize: 20,
    });
    for (const editorSize of [9, 49, Number.NaN]) {
      expect(
        fontsOf({ editor: "lora", editorSize }),
        String(editorSize),
      ).toEqual({ editor: "lora" });
    }
  });
});

const info = (page: string, scheme: "light" | "dark"): ThemeInfo => ({
  page,
  displayName: page,
  scheme,
});
const paperDark = info("Library/x/Paper Dark", "dark");
const paperLight = info("Library/x/Paper Light", "light");
const themes = [
  info(BUILTIN_LIGHT_THEME, "light"),
  info(BUILTIN_DARK_THEME, "dark"),
  paperDark,
  paperLight,
];

describe("resolveTheme", () => {
  const resolved = (theme: ThemeInfo, fallback = false) => ({
    theme,
    fallback,
  });

  it("prefers device over space over the fallback", () => {
    expect(
      resolveTheme(
        { device: paperLight.page, space: paperDark.page, prefersDark: true },
        themes,
      ),
    ).toEqual(resolved(paperLight));
    expect(
      resolveTheme({ space: paperDark.page, prefersDark: false }, themes),
    ).toEqual(resolved(paperDark));
  });

  it("skips a device theme that no longer exists", () => {
    expect(
      resolveTheme(
        { device: "Gone", space: paperDark.page, prefersDark: false },
        themes,
      ),
    ).toEqual(resolved(paperDark));
  });

  it("falls back to the built-in for the OS scheme", () => {
    expect(
      resolveTheme(
        { device: "Gone", space: "Gone", prefersDark: true },
        themes,
      ),
    ).toEqual(resolved(themes[1], true));
    expect(resolveTheme({ prefersDark: false }, themes)).toEqual(
      resolved(themes[0], true),
    );
  });

  it("synthesizes the built-in when themes is empty", () => {
    expect(resolveTheme({ prefersDark: true }, []).theme).toEqual({
      page: BUILTIN_DARK_THEME,
      displayName: "SilverBullet Dark",
      scheme: "dark",
    });
    expect(resolveTheme({ prefersDark: false }, []).theme).toEqual({
      page: BUILTIN_LIGHT_THEME,
      displayName: "SilverBullet Light",
      scheme: "light",
    });
  });
});

describe("counterpartTheme", () => {
  it("finds the installed counterpart only", () => {
    const night = { ...paperDark, counterpart: paperLight.page };
    expect(counterpartTheme(night, themes)).toBe(paperLight);
    expect(counterpartTheme(night, [])).toBeUndefined();
    expect(counterpartTheme(paperDark, themes)).toBeUndefined();
  });
});

describe("themeCss", () => {
  const block = (page: string, code: string) => ({ page, code });
  const blocks = [
    block(BUILTIN_LIGHT_THEME, "light{}"),
    block(BUILTIN_DARK_THEME, "dark1{}"),
    block(BUILTIN_DARK_THEME, "dark2{}"),
    block(paperDark.page, "paper{}"),
  ];

  it("puts the built-in for the scheme before a library theme", () => {
    expect(themeCss(paperDark, blocks)).toBe(
      "<style>dark1{}</style><style>dark2{}</style><style>paper{}</style>",
    );
  });

  it("works when no built-in blocks are present", () => {
    expect(themeCss(paperDark, [block(paperDark.page, "p{}")])).toBe(
      "<style>p{}</style>",
    );
  });

  it("is empty when the theme has no blocks", () => {
    expect(themeCss(paperDark, [])).toBe("");
  });

  it("includes a built-in theme once", () => {
    expect(themeCss(info(BUILTIN_DARK_THEME, "dark"), blocks)).toBe(
      "<style>dark1{}</style><style>dark2{}</style>",
    );
  });
});

describe("migrateDarkMode", () => {
  it("maps the flag to a built-in theme", () => {
    expect(migrateDarkMode(true, undefined)).toBe(BUILTIN_DARK_THEME);
    expect(migrateDarkMode(false, undefined)).toBe(BUILTIN_LIGHT_THEME);
    expect(migrateDarkMode(undefined, undefined)).toBeUndefined();
  });

  it("keeps the space theme when its scheme already matches", () => {
    expect(migrateDarkMode(true, paperDark)).toBeUndefined();
    expect(migrateDarkMode(false, paperLight)).toBeUndefined();
    expect(migrateDarkMode(true, paperLight)).toBe(BUILTIN_DARK_THEME);
  });
});

describe("accentCss", () => {
  it("sets the accent after the theme", () => {
    expect(accentCss("#0f766e")).toBe(
      "<style data-sb-accent>html{--ui-accent-color:#0f766e;}</style>",
    );
  });
  it("is empty when unset or not a plain value", () => {
    expect(accentCss(undefined)).toBe("");
    expect(accentCss("  ")).toBe("");
    expect(accentCss("red;} body{display:none")).toBe("");
    expect(accentCss("</style><script>")).toBe("");
  });
});
