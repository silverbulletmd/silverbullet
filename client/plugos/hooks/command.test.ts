import type { CommandHookT } from "@silverbulletmd/silverbullet/type/manifest";
import { expect, test, vi } from "vitest";
import type { Command } from "../../types/command.ts";
import type { System } from "../system.ts";
import { CommandHook } from "./command.ts";

function hook(
  opts: {
    readOnly?: boolean;
    disableServiceWorker?: boolean;
    extra?: Map<string, Command>;
  } = {},
): CommandHook {
  return new CommandHook(
    opts.readOnly ?? false,
    opts.extra ?? new Map(),
    opts.disableServiceWorker ?? false,
  );
}

function names(commands: Map<string, Command>): string[] {
  return [...commands.keys()].sort();
}

test("requireServiceWorker commands are omitted when the service worker is off", () => {
  const commands = hook({ disableServiceWorker: true });
  commands.registerCommand({ name: "Keep Me", run: async () => {} });
  commands.registerCommand({
    name: "Sync: Space",
    requireServiceWorker: true,
    run: async () => {},
  });

  expect(names(commands.buildAllCommands())).toEqual(["Keep Me"]);
});

test("requireServiceWorker commands stay registered when the service worker is on", () => {
  const commands = hook();
  commands.registerCommand({
    name: "Sync: Space",
    requireServiceWorker: true,
    run: async () => {},
  });

  expect(names(commands.buildAllCommands())).toEqual(["Sync: Space"]);
});

test("an explicit key override with an empty mac replaces a built-in mac binding", () => {
  const commands = hook({
    extra: new Map([
      [
        "Open Command Palette",
        { name: "Open Command Palette", key: "Mod-p", mac: "" },
      ],
      ["Share: Page", { name: "Share: Page", key: "", mac: "" }],
    ]),
  });
  commands.registerCommand({
    name: "Open Command Palette",
    key: "Ctrl-/",
    mac: "Cmd-/",
    run: async () => {},
  });
  commands.registerCommand({
    name: "Share: Page",
    key: "Ctrl-p",
    mac: "Cmd-p",
    run: async () => {},
  });
  commands.system = {
    loadedPlugs: new Map(),
  } as unknown as System<CommandHookT>;

  const palette = commands.buildAllCommands().get("Open Command Palette");
  const share = commands.buildAllCommands().get("Share: Page");
  expect(palette).toMatchObject({ key: "Mod-p", mac: "" });
  expect(share).toMatchObject({ key: "", mac: "" });
});

test("plug commands with requireServiceWorker are omitted when the service worker is off", () => {
  const commands = hook({ disableServiceWorker: true });
  const invoke = vi.fn();
  commands.system = {
    loadedPlugs: new Map([
      [
        "sync",
        {
          manifest: {
            functions: {
              syncSpaceCommand: {
                command: {
                  name: "Sync: Space",
                  requireServiceWorker: true,
                  menu: {
                    location: "space",
                    group: "1_sync",
                    order: 1,
                    label: "Sync Space",
                  },
                },
              },
              syncFileCommand: {
                command: {
                  name: "Sync: File",
                  requireServiceWorker: true,
                },
              },
              other: {
                command: { name: "Other: Thing" },
              },
            },
          },
          invoke,
        },
      ],
    ]),
  } as unknown as System<CommandHookT>;

  expect(names(commands.buildAllCommands())).toEqual(["Other: Thing"]);
});
