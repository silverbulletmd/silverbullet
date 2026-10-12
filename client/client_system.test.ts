import { describe, expect, test, vi } from "vitest";
import type { Client } from "./client.ts";
import { ClientSystem, wirePerFileEvents } from "./client_system.ts";
import { EventHook } from "./plugos/hooks/event.ts";
import { EventInterest } from "./event_interest.ts";
import { System } from "./plugos/system.ts";
import type { EventHookT } from "@silverbulletmd/silverbullet/type/manifest";
import type { DataStore } from "./data/datastore.ts";
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
      loadCustomStyles: async () => {},
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
    } as unknown as ClientSystem;

    await ClientSystem.prototype.reloadState.call(clientSystem);

    expect(await rebuiltWith).toEqual({ environment: "new" });
  });
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
