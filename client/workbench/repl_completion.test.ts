import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { expect, test } from "vitest";
import { LuaEnv, LuaTable } from "../space_lua/runtime.ts";
import { luaBuildStandardEnv } from "../space_lua/stdlib.ts";
import { replCompletionSource } from "./repl_completion.ts";

async function complete(env: LuaEnv, doc: string) {
  const state = EditorState.create({ doc });
  const ctx = new CompletionContext(state, doc.length, true);
  return await replCompletionSource(() => env)(ctx);
}

test("offers console locals", async () => {
  const env = new LuaEnv(luaBuildStandardEnv());
  env.setLocal("myTasks", new LuaTable());
  const result = await complete(env, "myT");
  expect(result?.options.map((o) => o.label)).toContain("myTasks");
  expect(result?.from).toBe(0);
});

test("offers members after a dot", async () => {
  const env = new LuaEnv(luaBuildStandardEnv());
  const result = await complete(env, "string.up");
  expect(result?.options.map((o) => o.label)).toContain("upper(s)");
});

test("nothing inside a string", async () => {
  const env = new LuaEnv(luaBuildStandardEnv());
  expect(await complete(env, 'x = "str')).toBeNull();
});

test("explicit trigger with an empty prefix offers globals", async () => {
  const env = new LuaEnv(luaBuildStandardEnv());
  const result = await complete(env, "x = ");
  expect(result?.options.map((o) => o.label)).toContain("string");
});

test("typing after a space does not open the global list", async () => {
  const env = new LuaEnv(luaBuildStandardEnv());
  const state = EditorState.create({ doc: "print(" });
  const ctx = new CompletionContext(state, 6, false);
  expect(await replCompletionSource(() => env)(ctx)).toBeNull();
});

test("nothing inside a comment, but a -- inside a string is not one", async () => {
  const env = new LuaEnv(luaBuildStandardEnv());
  expect(await complete(env, "x = 1 -- str")).toBeNull();
  const result = await complete(env, 'x = "a--b" .. string.up');
  expect(result?.options.map((o) => o.label)).toContain("upper(s)");
});
