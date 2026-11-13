import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import type { Client } from "../client.ts";
import { loadConfig } from "../boot_config.ts";
import { extractSpaceLuaFromPageText } from "../space_lua_blocks_test_util.ts";
import {
  buttonLabel,
  buttonsFor,
  type MarkupButton,
  markupButtons,
  markupSurfaces,
} from "./markup_buttons.ts";

/** The Std config with the markup bar API, plus `extra` Space Lua after it */
async function stdConfig(extra = "") {
  const lua = [
    "libraries/Library/Std/APIs/Schema.md",
    "libraries/Library/Std/Config.md",
    "libraries/Library/Std/APIs/Markup Bar.md",
  ]
    .map((path) => extractSpaceLuaFromPageText(readFileSync(path, "utf8")))
    .join("\n");
  const config = await loadConfig(
    [
      { ref: "std", code: lua },
      { ref: "user", code: extra },
    ],
    {},
    false,
  );
  return { config };
}

/** A button as data: its run function (if any) as `run: true` */
const plain = (buttons: MarkupButton[]) =>
  buttons.map(({ run, ...rest }) => (run ? { ...rest, run: true } : rest));

describe("the default lists (Library/Std/Config.md)", () => {
  const surfaces = ["mobile", "selection", "line"] as const;

  test("every surface has buttons that do something and say what", async () => {
    const client = await stdConfig();
    for (const surface of surfaces) {
      const buttons = markupButtons(client, surface);
      expect(buttons.length).toBeGreaterThan(0);
      for (const button of buttons) {
        expect(button.icon).toBeTruthy();
        expect(buttonLabel(button)).toBeTruthy();
        // A button with neither would do nothing
        expect(
          Boolean(button.command) || typeof button.run === "function",
        ).toBe(true);
      }
    }
  });

  test("selection buttons stay out of code and front matter, and lead with bold", async () => {
    const buttons = markupButtons(await stdConfig(), "selection");
    expect(buttons[0].command).toBe("Text: Bold");
    for (const button of buttons) {
      expect(button.exceptContexts).toEqual(
        expect.arrayContaining(["FencedCode", "FrontMatter"]),
      );
    }
  });

  test("only line buttons are grouped or ticked, and a group is contiguous", async () => {
    const client = await stdConfig();
    for (const surface of ["mobile", "selection"] as const) {
      for (const button of markupButtons(client, surface)) {
        expect(button.group).toBeUndefined();
        expect(button.activeContexts).toBeUndefined();
      }
    }
    const groups = markupButtons(client, "line")
      .map((button) => button.group)
      .filter((group, i, all) => group !== undefined && group !== all[i - 1]);
    expect(groups.length).toBeGreaterThan(0);
    expect(new Set(groups).size).toBe(groups.length);
  });
});

describe("markupBar.define and the keyboardBar aliases", () => {
  const descriptions = (
    client: Pick<Client, "config">,
    surface: "mobile" | "line",
  ) => markupButtons(client, surface).map((b) => b.description);

  test("markupBar.define appends to the surface it names", async () => {
    const client = await stdConfig(`
      markupBar.define { surface = "line", icon = "x", description = "Mine" }
      markupBar.define { surface = "selection", icon = "x", description = "Sel" }
    `);
    expect(descriptions(client, "line").at(-1)).toBe("Mine");
    expect(markupButtons(client, "selection").at(-1)).toEqual({
      icon: "x",
      description: "Sel",
    });
    expect(descriptions(client, "mobile")).not.toContain("Mine");
  });

  test("markupBar.define without a valid surface fails, adding nothing", async () => {
    const before = markupButtons(await stdConfig(), "line").length;
    const client = await stdConfig(`
      markupBar.define { icon = "x", description = "Lost" }
    `);
    expect(markupButtons(client, "line")).toHaveLength(before);
    expect(descriptions(client, "mobile")).not.toContain("Lost");
  });

  test("keyboardBar.define adds to the phone bar only", async () => {
    const client = await stdConfig(`
      keyboardBar.define { icon = "x", description = "Phone" }
    `);
    expect(descriptions(client, "mobile").at(-1)).toBe("Phone");
    expect(descriptions(client, "line")).not.toContain("Phone");
  });

  test("a space's keyboardBar list replaces the phone bar, not the desktop lists", async () => {
    const defaults = await stdConfig();
    const client = await stdConfig(`
      config.set("keyboardBar", { { icon = "x", description = "Old" } })
      keyboardBar.define { icon = "y", description = "Older" }
      markupBar.define { surface = "mobile", icon = "z", description = "New" }
    `);
    expect(descriptions(client, "mobile")).toEqual(["Old", "Older", "New"]);
    for (const surface of ["line", "selection"] as const) {
      expect(plain(markupButtons(client, surface))).toEqual(
        plain(markupButtons(defaults, surface)),
      );
    }
  });
});

test("buttonsFor filters by context", () => {
  const list = [
    { icon: "b", exceptContexts: ["FencedCode"] },
    { icon: "i", onlyContexts: ["ListItem"] },
  ];
  expect(buttonsFor(list, ["Paragraph"]).map((b) => b.icon)).toEqual(["b"]);
  expect(buttonsFor(list, ["FencedCode:lua"])).toEqual([]);
  expect(
    buttonsFor(list, ["Paragraph", "ListItem", "BulletList"]).map(
      (b) => b.icon,
    ),
  ).toEqual(["b", "i"]);
});

describe("markupSurfaces", () => {
  const surfaces = (
    options: {
      isMobile?: boolean;
      toggle?: boolean;
      readOnlyMode?: boolean;
      readOnlyState?: boolean;
      selectionBubble?: boolean;
      lineHandle?: boolean;
    } = {},
  ) => {
    const values: Record<string, unknown> = {
      "markupBar.selectionBubble": options.selectionBubble,
      "markupBar.lineHandle": options.lineHandle,
    };
    const client = {
      config: {
        get: (path: string | string[], fallback: unknown) =>
          values[[path].flat().join(".")] ?? fallback,
      },
      isReadOnlyMode: () => options.readOnlyMode ?? false,
      ui: {
        viewState: {
          isMobile: options.isMobile ?? false,
          uiOptions: { markupBar: options.toggle ?? true },
        },
      },
    } as never;
    return markupSurfaces(client, { readOnly: options.readOnlyState ?? false });
  };

  test("desktop: bubble, line buttons, Add tag and widget menus; no phone bar", () => {
    expect(surfaces()).toEqual({
      mobile: false,
      selection: true,
      line: true,
      addTag: true,
      widget: true,
    });
  });

  test("mobile: the phone bar only (widgets keep their ⋯)", () => {
    expect(surfaces({ isMobile: true })).toEqual({
      mobile: true,
      selection: false,
      line: false,
      addTag: false,
      widget: false,
    });
  });

  test("read-only space, page or editor: only desktop widget menus", () => {
    const off = { mobile: false, selection: false, line: false, addTag: false };
    for (const isMobile of [false, true]) {
      const widgetOnly = { ...off, widget: !isMobile };
      expect(surfaces({ isMobile, readOnlyMode: true })).toEqual(widgetOnly);
      expect(surfaces({ isMobile, readOnlyState: true })).toEqual(widgetOnly);
    }
  });

  test("the device toggle turns off all but Add tag and widget menus", () => {
    expect(surfaces({ toggle: false })).toEqual({
      mobile: false,
      selection: false,
      line: false,
      addTag: true,
      widget: true,
    });
    expect(surfaces({ isMobile: true, toggle: false }).mobile).toBe(false);
  });

  test("markupBar.selectionBubble = false turns off just the bubble", () => {
    expect(surfaces({ selectionBubble: false })).toEqual({
      mobile: false,
      selection: false,
      line: true,
      addTag: true,
      widget: true,
    });
  });

  test("markupBar.lineHandle = false turns off the line menu, Add tag included; widget menus stay", () => {
    expect(surfaces({ lineHandle: false })).toEqual({
      mobile: false,
      selection: true,
      line: false,
      addTag: false,
      widget: true,
    });
  });
});
