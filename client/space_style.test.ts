// @vitest-environment happy-dom
import {
  BUILTIN_DARK_THEME,
  type ThemeInfo,
  themeCss,
} from "@silverbulletmd/silverbullet/lib/themes";
import { beforeEach, expect, test } from "vitest";
import type { Client } from "./client.ts";
import { SpaceStyles } from "./space_style.ts";
import type { ToolBlock } from "./tooling.ts";

const dark: ThemeInfo = {
  page: BUILTIN_DARK_THEME,
  displayName: "SilverBullet Dark",
  scheme: "dark",
};
const warm: ThemeInfo = {
  page: "Library/Mine/Warm Night",
  displayName: "Warm Night",
  scheme: "dark",
};
const cool: ThemeInfo = {
  page: "Library/Mine/Cool Day",
  displayName: "Cool Day",
  scheme: "light",
};

function block(page: string, code: string): ToolBlock {
  return { ref: `${page}@1`, page, pos: 1, code, priority: 0, boot: false };
}

const themeStyles = [
  block(BUILTIN_DARK_THEME, "html{--a:1}"),
  block(warm.page, "html{--b:2}"),
  block(cool.page, "html{--c:3}"),
];
const ordinary = [block("Mine", "p{color:red}")];

let active: ThemeInfo | undefined;
let tooling:
  | { themes: ThemeInfo[]; themeStyles: ToolBlock[]; styles: ToolBlock[] }
  | undefined;
let customStyles: unknown;
let styles: SpaceStyles;

beforeEach(() => {
  document.body.innerHTML =
    '<div id="sb-theme"></div><div id="custom-styles"></div>';
  active = warm;
  tooling = { themes: [dark, warm, cool], themeStyles, styles: ordinary };
  customStyles = undefined;
  styles = new SpaceStyles({
    bootConfig: {},
    get tooling() {
      return tooling;
    },
    spaceTheme: {
      get active() {
        return active;
      },
    },
    ui: {
      viewDispatch: (action: { key: string; value: unknown }) => {
        customStyles = action.value;
      },
    },
  } as unknown as Client);
});

/** What the theme container holds once `active` is applied, as SpaceTheme leaves it. */
function applyTheme(): void {
  document.getElementById("sb-theme")!.innerHTML = active
    ? themeCss(active, themeStyles)
    : "";
}

const summary = (s: SpaceStyles) =>
  s.lastLoad!.styles.map((r) => [
    r.theme ?? "-",
    r.active,
    r.rules,
    r.themeName,
  ]);

test("the record lists theme blocks in load order, inactive themes last", () => {
  applyTheme();
  styles.load();
  expect(summary(styles)).toEqual([
    [BUILTIN_DARK_THEME, true, 1, "SilverBullet Dark"],
    [warm.page, true, 1, "Warm Night"],
    ["-", true, 1, undefined],
    [cool.page, false, 0, "Cool Day"],
  ]);
});

test("switching theme rebuilds the record and tells listeners", () => {
  applyTheme();
  styles.load();
  const seen: number[] = [];
  styles.onLoad((l) => seen.push(l.styles.length));
  active = cool;
  applyTheme();
  styles.themeChanged();
  // Light scheme: its (absent) built-in base, then Cool Day; dark ones inactive
  expect(summary(styles)).toEqual([
    [cool.page, true, 1, "Cool Day"],
    ["-", true, 1, undefined],
    [BUILTIN_DARK_THEME, false, 0, "SilverBullet Dark"],
    [warm.page, false, 0, "Warm Night"],
  ]);
  expect(seen).toEqual([4]);
});

test("nothing is known to apply before a theme is shown", () => {
  active = undefined;
  styles.load();
  expect(summary(styles)).toEqual([["-", true, 1, undefined]]);
});

test("without tooling there are no styles", () => {
  tooling = undefined;
  styles.load();
  expect(styles.lastLoad!.styles).toEqual([]);
});

test("panels get the styles and an empty theme container their messages fill", () => {
  applyTheme();
  styles.load();
  expect(customStyles).toBe(
    '<div id="sb-theme" hidden></div><style>p{color:red}</style>',
  );
});
