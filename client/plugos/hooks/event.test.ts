import { expect, test, vi } from "vitest";
import { Config } from "../../config.ts";
import type { System } from "../system.ts";
import type { SyscallDefinition } from "../system.ts";
import type { EventHookT } from "@silverbulletmd/silverbullet/type/manifest";
import { EventHook } from "./event.ts";
import { listenerDefinition } from "../syscalls/event.ts";
import { eventSyscalls } from "../syscalls/event.ts";
import type { Client } from "../../client.ts";
import { parseBlock } from "../../space_lua/parse.ts";
import type { LuaFunctionCallStatement } from "../../space_lua/ast.ts";
import { evalExpression } from "../../space_lua/eval.ts";
import {
  LuaEnv,
  LuaStackFrame,
  luaValueToJS,
} from "../../space_lua/runtime.ts";

test("event dispatch keeps Lua listener definitions and preserves ordinary results", async () => {
  const ref = {
    path: "Test/Page.md",
    details: { type: "position" as const, pos: 33 },
  };
  const fromLua = () => "lua widget";
  (fromLua as typeof fromLua & { [listenerDefinition]?: typeof ref })[
    listenerDefinition
  ] = ref;
  const config = new Config({
    eventListeners: {
      "test:event": [fromLua, () => Promise.reject(new Error("skip"))],
    },
  });
  const hook = new EventHook(config);
  hook.apply({
    loadedPlugs: new Map(),
    on: () => {},
  } as unknown as System<EventHookT>);
  hook.addLocalListener("test:event", () => "local widget");
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    expect(await hook.dispatchEventWithSources("test:event")).toEqual([
      { value: "local widget", definition: null },
      { value: "lua widget", definition: ref },
    ]);
    expect(await hook.dispatchEvent("test:event")).toEqual([
      "local widget",
      "lua widget",
    ]);
    await expect(hook.dispatchEventStrict("test:event")).rejects.toThrow(
      "skip",
    );
  } finally {
    consoleError.mockRestore();
  }
});

test("event.listen retains the source of its Lua run callback", async () => {
  const config = new Config();
  const hook = new EventHook(config);
  hook.apply({
    loadedPlugs: new Map(),
    on: () => {},
  } as unknown as System<EventHookT>);
  const block = parseBlock('_(function() return "widget" end)', {
    ref: "Test/Page@10",
  });
  const expression = (block.statements[0] as LuaFunctionCallStatement).call
    .args[0];
  const fn = evalExpression(
    expression,
    new LuaEnv(),
    new LuaStackFrame(new LuaEnv(), expression.ctx),
  );
  const run = luaValueToJS(fn, LuaStackFrame.lostFrame);
  const syscall = eventSyscalls(hook, { config } as Client)[
    "event.listen"
  ] as SyscallDefinition;
  await syscall.callback(null as never, { name: "test:event", run });

  expect(await hook.dispatchEventWithSources("test:event")).toEqual([
    {
      value: "widget",
      definition: {
        path: "Test/Page.md",
        details: { type: "position", pos: 33 },
      },
    },
  ]);
});

test("plug listener results name the plug function that produced them", async () => {
  const hook = new EventHook();
  const plug = {
    manifest: {
      name: "index",
      functions: { lintYAML: { events: ["editor:lint"] } },
    },
    canInvoke: () => true,
    invoke: async () => [{ from: 0, to: 1 }],
  };
  hook.apply({
    loadedPlugs: new Map([["index", plug]]),
    on: () => {},
  } as unknown as System<EventHookT>);
  expect(await hook.dispatchEventWithSources("editor:lint")).toEqual([
    {
      value: [{ from: 0, to: 1 }],
      definition: null,
      listener: "index.lintYAML",
    },
  ]);
});

test("removing the last listener of a name forgets the name", () => {
  const hook = new EventHook();
  const cb = () => {};
  hook.addLocalListener("n", cb);
  hook.removeLocalListener("n", cb);
  expect(hook.listenerCount()).toEqual({ names: 0, listeners: 0 });
});

test("a listener name with regex characters matches only itself", async () => {
  const hook = new EventHook();
  hook.apply({
    loadedPlugs: new Map(),
    on: () => {},
  } as unknown as System<EventHookT>);
  const calls: string[] = [];
  hook.addLocalListener("file:changed:C++ (draft).md", () => calls.push("c"));
  hook.addLocalListener("page:*", () => calls.push("wild"));
  await hook.dispatchEvent("file:changed:C++ (draft).md");
  await hook.dispatchEvent("file:changed:CCC (draft)xmd");
  await hook.dispatchEvent("page:x");
  expect(calls).toEqual(["c", "wild"]);
});

test("a listener removing itself during dispatch doesn't skip the next one", async () => {
  const hook = new EventHook();
  hook.apply({
    loadedPlugs: new Map(),
    on: () => {},
  } as unknown as System<EventHookT>);
  const calls: string[] = [];
  const first = () => {
    calls.push("first");
    hook.removeLocalListener("n", first);
  };
  hook.addLocalListener("n", first);
  hook.addLocalListener("n", () => calls.push("second"));
  await hook.dispatchEvent("n");
  expect(calls).toEqual(["first", "second"]);
});
