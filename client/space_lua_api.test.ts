import { expect, test } from "vitest";
import { System } from "./plugos/system.ts";
import {
  type ILuaFunction,
  LuaEnv,
  LuaStackFrame,
  type LuaTable,
} from "./space_lua/runtime.ts";
import { luaBuildStandardEnv } from "./space_lua/stdlib.ts";
import { exposeSyscalls } from "./space_lua_api.ts";

test("documented syscalls retain metadata when exposed to Lua", async () => {
  const system = new System();
  system.registerSyscalls([], {
    "example.greet": {
      callback: (_ctx, name: string) => `Hello ${name}`,
      description: "Greets someone.",
      parameters: [{ name: "name", type: "string" }],
      returns: [{ type: "string" }],
      see: "API/example",
    },
  });

  const env = new LuaEnv(luaBuildStandardEnv());
  exposeSyscalls(env, system);
  const namespace = env.get("example") as LuaTable;
  const fn = namespace.get("greet") as ILuaFunction;
  expect(fn.info).toEqual({
    kind: "syscall",
    name: "example.greet",
    description: "Greets someone.",
    parameters: [{ name: "name", type: "string" }],
    returns: [{ type: "string" }],
    see: "API/example",
  });

  const sf = LuaStackFrame.createWithGlobalEnv(env);
  const spacelua = env.get("spacelua", sf) as LuaTable;
  const renderDocumentation = spacelua.get(
    "renderApiDocumentation",
    sf,
  ) as ILuaFunction;
  expect(await renderDocumentation.call(sf, "example")).toContain(
    "### `example.greet`",
  );
  expect(await renderDocumentation.call(sf)).toContain("### `print`");
  expect(renderDocumentation.info?.parameters?.[0]?.optional).toBe(true);
});

test("legacy syscall registrations get an API page reference", () => {
  const system = new System();
  system.registerSyscalls([], {
    "example.ping": () => "pong",
  });
  expect(system.registeredSyscalls.get("example.ping")?.see).toBe(
    "API/example",
  );
});
