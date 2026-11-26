import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { extractSpaceLuaFromPageText } from "./space_lua_blocks_test_util.ts";
import { evalStatement } from "./space_lua/eval.ts";
import { parseBlock } from "./space_lua/parse.ts";
import { LuaEnv, LuaStackFrame } from "./space_lua/runtime.ts";
import { luaBuildStandardEnv } from "./space_lua/stdlib.ts";

async function run(env: LuaEnv, code: string) {
  const block = parseBlock(code);
  await evalStatement(
    block,
    env,
    LuaStackFrame.createWithGlobalEnv(env, block.ctx),
  );
}

test("a virtual page's run receives every captured group (#1956)", async () => {
  const source = await readFile(
    new URL("../libraries/Library/Std/APIs/Virtual Page.md", import.meta.url),
    "utf8",
  );
  const env = new LuaEnv(luaBuildStandardEnv());
  await run(
    env,
    `
    local pages = {}
    config = {
      merge = function(path, def) pages[path[2]] = def end,
      get = function(key, default)
        if key == "virtualPages" then return pages end
        return default
      end,
    }
    event = { listen = function(spec) listener = spec end }
    `,
  );
  await run(env, extractSpaceLuaFromPageText(source));
  await run(
    env,
    `
    virtualPage.define {
      pattern = "^item:(%w+)/(%w+)$",
      run = function(kind, id) return kind .. "|" .. tostring(id) end,
    }
    result = listener.run({ data = { name = "item:book/42" } })
    missing = listener.run({ data = { name = "other" } })
    `,
  );
  const result = env.get("result") as { get(key: string): unknown };
  expect(result.get("text")).toBe("book|42");
  expect(result.get("perm")).toBe("ro");
  expect(env.get("missing") ?? null).toBeNull();
});
