import { expect, test, vi } from "vitest";
import { CommandHook } from "./command.ts";
import type { Command } from "../../types/command.ts";
import type { CommandHookT } from "@silverbulletmd/silverbullet/type/manifest";
import type { System } from "../system.ts";

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
