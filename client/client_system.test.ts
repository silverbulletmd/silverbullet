import type { EventHookT } from "@silverbulletmd/silverbullet/type/manifest";
import { describe, expect, test, vi } from "vitest";
import type { Client } from "./client.ts";
import { ClientSystem, wirePerFileEvents } from "./client_system.ts";
import { Config } from "./config.ts";
import type { DataStore } from "./data/datastore.ts";
import { EventInterest } from "./event_interest.ts";
import { CommandHook } from "./plugos/hooks/command.ts";
import { EventHook } from "./plugos/hooks/event.ts";
import { System } from "./plugos/system.ts";
import type { Command } from "./types/command.ts";
import { WidgetCache } from "./widget_cache.ts";

vi.mock("./sandbox/widget_sandbox_iframe.ts", () => ({}));
vi.mock("./navigator/navigator.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./navigator/navigator.ts")>()),
  restoreDocks: async () => {},
}));

describe("ClientSystem.reloadState (system.reboot)", () => {
  test("rebuilt widgets don't reuse results from the previous Lua environment", async () => {
    const widgetCache = new WidgetCache(
      {} as DataStore,
      new EventInterest(new EventHook()),
    );
    // The Lua environment that rendered the page before the reboot.
    let environment = "old";
    const renderWidget = () =>
      widgetCache.prewarmResult("lua:board.tasks():Tasks", async () => ({
        environment,
      }));
    expect(await renderWidget()).toEqual({ environment: "old" });

    let rebuiltWith: unknown;
    const client = {
      widgetCache,
      fetchTooling: async () => undefined,
      loadCustomStyles: () => {},
      // Rebuilding the editor state constructs fresh widgets, which prewarm.
      rebuildEditorState: () => {
        rebuiltWith = renderWidget();
      },
    } as unknown as Client;
    const clientSystem = {
      client,
      loadLuaScripts: async () => {
        environment = "new";
      },
      reloadTooling: ClientSystem.prototype.reloadTooling,
      refreshAfterIndex: ClientSystem.prototype.refreshAfterIndex,
    } as unknown as ClientSystem;

    await ClientSystem.prototype.reloadState.call(clientSystem);

    expect(await rebuiltWith).toEqual({ environment: "new" });
  });
});

/** Wires `config` the way ClientSystem's constructor does. */
const watchScriptDefinitions = (clientSystem: ClientSystem, config: Config) =>
  (ClientSystem.prototype as any).watchScriptDefinitions.call(
    clientSystem,
    config,
  );

test("a command defined after scripts load shows up once applied", () => {
  const config = new Config();
  const scriptCommands = new Map<string, Command>();
  const commandHook = new CommandHook(false, scriptCommands);
  new System<any>(undefined).addHook(commandHook);
  const clientSystem = {
    client: { config },
    scriptCommands,
    luaCodeWidgets: new Map(),
    commandHook,
    slashCommandHook: { throttledBuildAllCommands: () => {} },
  } as unknown as ClientSystem;
  config.set(["commands", "Template: Late"], {
    name: "Template: Late",
    run: async () => {},
  });

  ClientSystem.prototype.applyScriptDefinitions.call(clientSystem);

  expect([...commandHook.buildAllCommands().keys()]).toContain(
    "Template: Late",
  );
});

test("defines from a listener after load go live in one throttled rebuild", async () => {
  vi.useFakeTimers();
  try {
    const config = new Config();
    const scriptCommands = new Map<string, Command>();
    const commandHook = new CommandHook(false, scriptCommands);
    new System<any>(undefined).addHook(commandHook);
    let rebuilds = 0;
    const clientSystem = {
      client: { config },
      scriptCommands,
      luaCodeWidgets: new Map(),
      commandHook,
      slashCommandHook: { throttledBuildAllCommands: () => {} },
      loadLuaScriptsInFlight: undefined,
      applyScriptDefinitions() {
        rebuilds++;
        ClientSystem.prototype.applyScriptDefinitions.call(this);
      },
    } as unknown as ClientSystem;
    watchScriptDefinitions(clientSystem, config);
    const hook = new EventHook();
    new System<EventHookT>(undefined).addHook(hook);
    // What `command.define` does
    hook.addLocalListener("my:event", () => {
      for (let i = 0; i < 20; i++) {
        config.merge(["commands", `Late ${i}`], {
          name: `Late ${i}`,
          run: async () => {},
        });
      }
    });

    await hook.dispatchEvent("my:event");
    expect(rebuilds).toBe(0);
    await vi.advanceTimersByTimeAsync(200);

    expect(rebuilds).toBe(1);
    expect([...commandHook.buildAllCommands().keys()]).toContain("Late 19");
  } finally {
    vi.useRealTimers();
  }
});

test("defines during a script load trigger no extra rebuild", async () => {
  vi.useFakeTimers();
  try {
    const config = new Config();
    let rebuilds = 0;
    const clientSystem = {
      loadLuaScriptsInFlight: Promise.resolve(),
      applyScriptDefinitions: () => rebuilds++,
    } as unknown as ClientSystem;
    watchScriptDefinitions(clientSystem, config);

    config.merge(["commands", "During Load"], { name: "During Load" });
    await vi.advanceTimersByTimeAsync(200);

    expect(rebuilds).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

test("file changes also fire per-file events", async () => {
  const hook = new EventHook();
  new System<EventHookT>(undefined).addHook(hook);
  wirePerFileEvents(hook);
  const seen: string[] = [];
  hook.addLocalListener("file:changed:Note.md", () => seen.push("changed"));
  await hook.dispatchEvent("file:changed", "Note.md");
  await hook.dispatchEvent("file:deleted", "Note.md");
  expect(seen).toEqual(["changed", "changed"]);
});
