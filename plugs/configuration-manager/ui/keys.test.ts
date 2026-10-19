import { describe, expect, test } from "vitest";
import { formatCommandUpdate, parseManagedBlock } from "../lua.ts";
import {
  normalizeLoadedOverride,
  resolvedBindings,
  seedOverrideFromManifest,
  writeBindings,
} from "./keys.ts";
import type { PendingShortcuts } from "./types.ts";

// Share: Page and Open Command Palette both ship a macOS-specific binding.
// Cmd is recorded as the portable Mod- alias; command.update must still clear
// `mac`, or that binding keeps winning on macOS.
const commands = {
  "Share: Page": { key: "Ctrl-p", mac: "Cmd-p" },
  "Open Command Palette": { key: "Ctrl-/", mac: "Cmd-/" },
};

function edit(
  pending: PendingShortcuts,
  name: string,
  list: string[],
  isMac: boolean,
): PendingShortcuts {
  const seeded = seedOverrideFromManifest(pending, name, commands, isMac);
  return writeBindings(seeded, name, list, isMac);
}

describe("macOS shortcut overrides", () => {
  test("removing a shortcut clears the mac binding as well as key", () => {
    const pending = edit({}, "Share: Page", [], true);

    expect(pending["Share: Page"]).toEqual({ key: "", mac: "" });
    expect(resolvedBindings("Share: Page", pending, commands, true)).toEqual(
      [],
    );
    expect(formatCommandUpdate("Share: Page", pending["Share: Page"])).toBe(
      'command.update { name = "Share: Page", key = "", mac = "" }',
    );
  });

  test("reassigning to a portable chord overrides the existing mac binding", () => {
    const pending = edit({}, "Open Command Palette", ["Mod-p"], true);

    expect(pending["Open Command Palette"]).toEqual({
      key: "Mod-p",
      mac: "",
    });
    expect(
      resolvedBindings("Open Command Palette", pending, commands, true),
    ).toEqual(["Mod-p"]);
    expect(
      formatCommandUpdate(
        "Open Command Palette",
        pending["Open Command Palette"],
      ),
    ).toBe(
      'command.update { name = "Open Command Palette", key = "Mod-p", mac = "" }',
    );
  });

  test("a reloaded empty mac does not hide the portable key on macOS", () => {
    const block = [
      'command.update { name = "Share: Page", key = "", mac = "" }',
      'command.update { name = "Open Command Palette", key = "Mod-p", mac = "" }',
    ].join("\n");
    const { commandOverrides } = parseManagedBlock(block);

    expect(
      resolvedBindings("Share: Page", commandOverrides, commands, true),
    ).toEqual([]);
    expect(
      resolvedBindings(
        "Open Command Palette",
        commandOverrides,
        commands,
        true,
      ),
    ).toEqual(["Mod-p"]);
    // Same config on other platforms uses `key` too.
    expect(
      resolvedBindings(
        "Open Command Palette",
        commandOverrides,
        commands,
        false,
      ),
    ).toEqual(["Mod-p"]);
  });

  test("an older portable override is rewritten so the next save clears mac", () => {
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
    expect(
      formatCommandUpdate(
        "Open Command Palette",
        normalizeLoadedOverride(loaded["Open Command Palette"]),
      ),
    ).toBe(
      'command.update { name = "Open Command Palette", key = "Mod-p", mac = "" }',
    );
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
