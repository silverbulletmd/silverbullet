import { expect, test } from "vitest";
import { encodeRef } from "../../plug-api/lib/ref.ts";
import type { LuaFunctionInfo } from "../../plug-api/types/index.ts";
import { System } from "../plugos/system.ts";
import { resolveASTReference } from "../space_lua.ts";
import { LuaEnv, LuaTable } from "./runtime.ts";
import { luaBuildStandardEnv } from "./stdlib.ts";
import { luaSyscalls } from "./syscalls.ts";

test("lua.inspect reflects live values and Lua definitions", async () => {
  const env = luaBuildStandardEnv();
  const source = {
    ref: "Library/Test@100",
    from: 5,
    to: 25,
  };
  const info: LuaFunctionInfo = {
    kind: "lua",
    name: "demo.greet",
    description: "Greets someone.",
    parameters: [{ name: "name", type: "string" }],
    source,
  };
  const greet = {
    info,
    call: () => "hello",
    asString: () => "<test function>",
  };
  env.setLocal(
    "demo",
    new LuaTable({
      greet,
      enabled: true,
    }),
  );

  const syscalls = luaSyscalls(new System(), () => env);
  const inspect = (syscalls["lua.inspect"] as any).callback;

  const root = await inspect({}, []);
  expect(root.properties).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ key: "demo", type: "table" }),
      expect.objectContaining({ key: "string", type: "table" }),
    ]),
  );

  const demo = await inspect({}, ["demo"]);
  expect(demo.properties).toEqual(
    expect.arrayContaining([
      {
        key: "enabled",
        type: "boolean",
      },
      {
        key: "greet",
        type: "function",
        functionInfo: info,
        definition: encodeRef(resolveASTReference(source)!),
      },
    ]),
  );

  expect(await inspect({}, ["demo", "missing"])).toBeNull();
});

test("lua.inspect with a page sees that page's variables over globals", async () => {
  const env = luaBuildStandardEnv();
  const pageEnv = new LuaEnv(env);
  pageEnv.setLocal("salary", 500);
  const syscalls = luaSyscalls(
    new System(),
    () => env,
    async (page) => (page === "Budget" ? pageEnv : null),
  );
  const inspect = (syscalls["lua.inspect"] as any).callback;

  const budget = await inspect({}, [], "Budget");
  expect(budget.properties).toEqual(
    expect.arrayContaining([
      { key: "salary", type: "number" },
      expect.objectContaining({ key: "string", type: "table" }),
    ]),
  );

  const other = await inspect({}, [], "Other");
  expect(other.properties.map((p: any) => p.key)).not.toContain("salary");
});
