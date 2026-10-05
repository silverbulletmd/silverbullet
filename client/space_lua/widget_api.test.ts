import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { extractSpaceLuaFromPageText } from "../boot_config.ts";
import { evalStatement } from "./eval.ts";
import { parseBlock } from "./parse.ts";
import {
  jsToLuaValue,
  LuaEnv,
  LuaStackFrame,
  type LuaTable,
} from "./runtime.ts";
import { luaBuildStandardEnv } from "./stdlib.ts";

async function widgetScript(): Promise<string> {
  const source = await readFile(
    new URL("../../libraries/Library/Std/APIs/Widget.md", import.meta.url),
    "utf8",
  );
  return extractSpaceLuaFromPageText(source);
}

async function widgetEnv() {
  const env = new LuaEnv(luaBuildStandardEnv());
  const liveCalls: unknown[] = [];
  env.set(
    "widget",
    jsToLuaValue({
      newLive: (spec: unknown) => {
        liveCalls.push(spec);
        return "live-value";
      },
    }),
  );
  env.set("jsonschema", jsToLuaValue({ validateObject: () => null }));
  const run = async (lua: string) => {
    const block = parseBlock(lua);
    await evalStatement(
      block,
      env,
      LuaStackFrame.createWithGlobalEnv(env, block.ctx),
    );
  };
  await run(await widgetScript());
  return { env, run, liveCalls };
}

test("widget.new hands source and content specs to the native live constructor", async () => {
  const { env, run, liveCalls } = await widgetEnv();
  await run(`
    sourced = widget.new { source = function() return {} end }
    computed = widget.new { content = function() return "x" end }
  `);
  expect(env.get("sourced")).toBe("live-value");
  expect(env.get("computed")).toBe("live-value");
  expect(liveCalls).toHaveLength(2);
});

test("widget.new keeps building static widgets itself", async () => {
  const { env, run, liveCalls } = await widgetEnv();
  await run(`plain = widget.markdown("**hi**")`);
  const value = env.get("plain") as LuaTable;
  expect(value.rawGet("markdown")).toBe("**hi**");
  expect(value.rawGet("_isWidget")).toBe(true);
  expect(liveCalls).toHaveLength(0);
});

test("re-running the Std widget script keeps the native constructor", async () => {
  const { env, run } = await widgetEnv();
  await run(await widgetScript());
  await run(`again = widget.new { source = function() return {} end }`);
  expect(env.get("again")).toBe("live-value");
});
