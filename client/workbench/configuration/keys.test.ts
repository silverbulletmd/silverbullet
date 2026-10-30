import { describe, expect, test } from "vitest";
import { applyManagedChanges } from "../../config_management/managed_edit.ts";
import {
  type CommandOverride,
  parseManagedBlock,
} from "../../config_management/managed_lua.ts";
import {
  allActiveBindings,
  findConflicts,
  keyEventToNotation,
  normalizeLoadedOverride,
  type PendingShortcuts,
  resolvedBindings,
  withBindings,
} from "./keys.ts";

const key = (init: Partial<KeyboardEvent>) => init as KeyboardEvent;

describe("keyEventToNotation", () => {
  test("Cmd is Mod on Mac, Ctrl is Mod elsewhere", () => {
    expect(keyEventToNotation(key({ key: "k", metaKey: true }), true)).toBe(
      "Mod-k",
    );
    expect(keyEventToNotation(key({ key: "k", ctrlKey: true }), false)).toBe(
      "Mod-k",
    );
  });

  test("Option+letter records the physical key on Mac", () => {
    expect(
      keyEventToNotation(key({ key: "®", code: "KeyR", altKey: true }), true),
    ).toBe("Alt-r");
  });

  test("a lone modifier is not a key", () => {
    expect(
      keyEventToNotation(key({ key: "Shift", shiftKey: true }), false),
    ).toBe(null);
  });
});

describe("findConflicts", () => {
  const commands = {
    "Example: One": { name: "Example: One", key: "Mod-k" },
    "Example: Two": { name: "Example: Two", key: "Mod-q q" },
  };
  const all = allActiveBindings({}, commands, false);
  const self = { name: "Example: Three", slot: 0 };

  test("an exact match is a duplicate", () => {
    expect(findConflicts(["Mod-k"], all, self).duplicate).toHaveLength(1);
  });

  test("the start of another chord is a prefix of it", () => {
    expect(findConflicts(["Mod-q"], all, self).prefixOfOther).toHaveLength(1);
  });

  test("a chord another binding starts is unreachable", () => {
    expect(findConflicts(["Mod-k", "x"], all, self).otherIsPrefix).toHaveLength(
      1,
    );
  });

  test("a binding never conflicts with its own slot", () => {
    expect(
      findConflicts(["Mod-k"], all, { name: "Example: One", slot: 0 })
        .duplicate,
    ).toEqual([]);
  });
});

describe("findConflicts across notations", () => {
  const commands = {
    "Example: Picker": { name: "Example: Picker", key: "Ctrl-k", mac: "Cmd-k" },
    "Example: Panel": { name: "Example: Panel", key: "Ctrl-Alt-j" },
  };
  const self = { name: "Example: Other", slot: 0 };

  test("a Cmd- binding is the same chord as Mod- on Mac", () => {
    const all = allActiveBindings({}, commands, true);
    expect(findConflicts(["Mod-k"], all, self, true).duplicate).toHaveLength(1);
  });

  test("a Ctrl- binding is the same chord as Mod- elsewhere", () => {
    const all = allActiveBindings({}, commands, false);
    expect(findConflicts(["Mod-k"], all, self, false).duplicate).toHaveLength(
      1,
    );
    expect(
      findConflicts(["Mod-Alt-j"], all, self, false).duplicate,
    ).toHaveLength(1);
  });

  test("modifier order and letter case don't matter", () => {
    const all = allActiveBindings(
      {},
      { X: { name: "X", key: "Shift-Alt-K" } },
      false,
    );
    expect(
      findConflicts(["Alt-Shift-k"], all, self, false).duplicate,
    ).toHaveLength(1);
  });
});

describe("withBindings", () => {
  test("portable chords go in key, clearing mac", () => {
    expect(withBindings({ mac: "Cmd-x" }, ["Mod-x"], true)).toEqual({
      key: "Mod-x",
      mac: "",
    });
  });

  test("a platform-specific chord goes in mac on Mac", () => {
    expect(withBindings(undefined, ["Ctrl-x"], true)).toEqual({
      mac: "Ctrl-x",
    });
  });
});

// Ported from silverbulletmd/silverbullet#2188 (fixes #2178). Both commands
// ship a macOS binding; `command.update` merges, so a portable override has
// to clear `mac` explicitly or the built-in one keeps winning on macOS.
describe("macOS shortcut overrides", () => {
  const commands = {
    "Share: Page": { name: "Share: Page", key: "Ctrl-p", mac: "Cmd-p" },
    "Open Command Palette": {
      name: "Open Command Palette",
      key: "Ctrl-/",
      mac: "Cmd-/",
    },
  };

  function edit(
    pending: PendingShortcuts,
    name: string,
    list: string[],
    isMac: boolean,
  ): PendingShortcuts {
    return { ...pending, [name]: withBindings(pending[name], list, isMac) };
  }

  /** The managed-block line saving `override` writes. */
  function written(name: string, override: CommandOverride): string {
    return applyManagedChanges("", {
      commands: { set: { [name]: override }, unset: [] },
    })
      .split("\n")
      .find((line) => line.startsWith("command.update"))!;
  }

  test("removing a shortcut clears the mac binding as well as key", () => {
    const pending = edit({}, "Share: Page", [], true);
    expect(pending["Share: Page"]).toEqual({ key: "", mac: "" });
    expect(resolvedBindings("Share: Page", pending, commands, true)).toEqual(
      [],
    );
    expect(written("Share: Page", pending["Share: Page"])).toBe(
      'command.update { name = "Share: Page", key = "", mac = "" }',
    );
  });

  test("reassigning to a portable chord overrides the existing mac binding", () => {
    const pending = edit({}, "Open Command Palette", ["Mod-p"], true);
    expect(pending["Open Command Palette"]).toEqual({ key: "Mod-p", mac: "" });
    expect(
      resolvedBindings("Open Command Palette", pending, commands, true),
    ).toEqual(["Mod-p"]);
    expect(
      written("Open Command Palette", pending["Open Command Palette"]),
    ).toBe(
      'command.update { name = "Open Command Palette", key = "Mod-p", mac = "" }',
    );
  });

  test("a reloaded empty mac does not hide the portable key", () => {
    const { commandOverrides } = parseManagedBlock(
      [
        'command.update { name = "Share: Page", key = "", mac = "" }',
        'command.update { name = "Open Command Palette", key = "Mod-p", mac = "" }',
      ].join("\n"),
    );
    expect(
      resolvedBindings("Share: Page", commandOverrides, commands, true),
    ).toEqual([]);
    for (const isMac of [true, false]) {
      expect(
        resolvedBindings(
          "Open Command Palette",
          commandOverrides,
          commands,
          isMac,
        ),
      ).toEqual(["Mod-p"]);
    }
  });

  test("an older portable override gets an explicit mac clear", () => {
    const loaded = parseManagedBlock(
      'command.update { name = "Share: Page", key = "" }\ncommand.update { name = "Open Command Palette", key = "Mod-p" }',
    ).commandOverrides;
    expect(normalizeLoadedOverride(loaded["Share: Page"])).toEqual({
      key: "",
      mac: "",
    });
    expect(normalizeLoadedOverride(loaded["Open Command Palette"])).toEqual({
      key: "Mod-p",
      mac: "",
    });
  });

  test("a non-portable key override is left alone", () => {
    expect(normalizeLoadedOverride({ key: "Ctrl-x" })).toEqual({
      key: "Ctrl-x",
    });
    expect(
      normalizeLoadedOverride({ key: "Mod-p", mac: "Cmd-Shift-p" }),
    ).toEqual({ key: "Mod-p", mac: "Cmd-Shift-p" });
  });

  test("a non-portable macOS chord is still stored on mac", () => {
    const pending = edit({}, "Share: Page", ["Ctrl-Alt-j"], true);
    expect(pending["Share: Page"]).toEqual({ mac: "Ctrl-Alt-j" });
    expect(resolvedBindings("Share: Page", pending, commands, true)).toEqual([
      "Ctrl-Alt-j",
    ]);
  });
});
