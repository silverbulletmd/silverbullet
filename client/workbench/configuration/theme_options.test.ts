import type { ThemeInfo } from "@silverbulletmd/silverbullet/lib/themes";
import { expect, test } from "vitest";
import {
  deviceThemeNote,
  missingThemeOption,
  previewPage,
  themeGroups,
} from "./theme_options.ts";

const themes: ThemeInfo[] = [
  { page: "T/Zed", displayName: "Zed", scheme: "dark" },
  { page: "T/Sepia", displayName: "Sepia", scheme: "light" },
  { page: "T/Alpha", displayName: "Alpha", scheme: "dark" },
];

test("themes are grouped by scheme and sorted by display name", () => {
  const g = themeGroups(themes);
  expect(g.light.map((t) => t.displayName)).toEqual(["Sepia"]);
  expect(g.dark.map((t) => t.displayName)).toEqual(["Alpha", "Zed"]);
});

test("the device note shows only with an override", () => {
  expect(deviceThemeNote(undefined, themes, false)).toBeUndefined();
  expect(deviceThemeNote("T/Sepia", themes, false)).toBe(
    "This device uses Sepia",
  );
});

test("the device note mentions returning to the override while previewing", () => {
  expect(deviceThemeNote("T/Sepia", themes, true)).toBe(
    "This device uses Sepia and returns to it after saving",
  );
});

test("the note falls back to the page's last segment for an unknown theme", () => {
  expect(deviceThemeNote("Gone/Theme X", themes, false)).toBe(
    "This device uses Theme X",
  );
});

test("an uninstalled set theme gets a labelled option", () => {
  expect(missingThemeOption("Gone/Theme X", themes)).toEqual({
    value: "Gone/Theme X",
    label: "Theme X (not installed)",
  });
  expect(missingThemeOption("T/Sepia", themes)).toBeUndefined();
  expect(missingThemeOption(undefined, themes)).toBeUndefined();
});

test("previews only a shown, changed value; unset follows the system", () => {
  expect(previewPage(false, "T/Zed", undefined, themes, false)).toBeUndefined();
  expect(previewPage(true, "T/Zed", "T/Zed", themes, false)).toBeUndefined();
  expect(previewPage(true, "T/Zed", undefined, themes, false)).toBe("T/Zed");
  expect(previewPage(true, undefined, "T/Zed", themes, true)).toBe(
    "Library/Std/Themes/SilverBullet Dark",
  );
  expect(previewPage(true, undefined, "T/Zed", themes, false)).toBe(
    "Library/Std/Themes/SilverBullet Light",
  );
});
