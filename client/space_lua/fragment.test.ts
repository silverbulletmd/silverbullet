import { expect, test } from "vitest";
import { evalExpression } from "./eval.ts";
import {
  fragmentParts,
  isFragmentValue,
  liveOf,
  makeFragment,
} from "./fragment.ts";
import { parseExpressionString } from "./parse.ts";
import {
  LuaEnv,
  LuaNativeJSFunction,
  LuaStackFrame,
  LuaTable,
} from "./runtime.ts";
import { luaBuildStandardEnv } from "./stdlib.ts";

function widget(markdown: string): LuaTable {
  return new LuaTable({ _isWidget: true, markdown });
}

async function evalWith(expr: string, vars: Record<string, unknown>) {
  const env = new LuaEnv(luaBuildStandardEnv());
  for (const [k, v] of Object.entries(vars)) env.set(k, v);
  return evalExpression(
    parseExpressionString(expr),
    env,
    LuaStackFrame.createWithGlobalEnv(env),
  );
}

test("makeFragment flattens nested fragments and merges strings", () => {
  const w = widget("x");
  const inner = makeFragment(["b", w]);
  const f = makeFragment(["a", inner, "c", 3, null]);
  expect(isFragmentValue(f)).toBe(true);
  expect(fragmentParts(f)).toEqual(["ab", w, "c3"]);
});

test("`..` with a widget yields a fragment; strings stay strings", async () => {
  const w = widget("x");
  const f = await evalWith('"pre " .. w .. " post"', { w });
  expect(fragmentParts(f)).toEqual(["pre ", w, " post"]);
  expect(await evalWith('"a" .. "b"', {})).toBe("ab");
});

test("table.concat with a widget yields a fragment with separators", async () => {
  const w = widget("x");
  const f = await evalWith('table.concat({"a", w, "b"}, ", ")', { w });
  expect(fragmentParts(f)).toEqual(["a, ", w, ", b"]);
  expect(await evalWith('table.concat({"a", "b"}, ",")', {})).toBe("a,b");
});

test("interpolation returns a fragment only when a widget is interpolated", async () => {
  const w = widget("x");
  expect(await evalWith('spacelua.interpolate("n=${n}", {n = 5})', {})).toBe(
    "n=5",
  );
  const f = await evalWith('spacelua.interpolate("b=${w}!", {w = w})', { w });
  expect(fragmentParts(f)).toEqual(["b=", w, "!"]);
});

test("concat of a widget with a plain table still errors", async () => {
  const w = widget("x");
  await expect(evalWith("w .. {}", { w })).rejects.toThrow(/concatenate/);
});

test("tostring and string functions refuse widgets", async () => {
  const w = widget("x");
  await expect(evalWith("tostring(w)", { w })).rejects.toThrow(
    /can't be used as text/,
  );
  await expect(evalWith("string.upper(w)", { w })).rejects.toThrow(
    /can't be used as text/,
  );
  await expect(evalWith('string.format("x %s", w)', { w })).rejects.toThrow(
    /can't be used as text/,
  );
  await expect(
    evalWith('string.format("%s %s", "a", w)', { w }),
  ).rejects.toThrow(/can't be used as text/);
  await expect(evalWith('string.rep("a", 2, w)', { w })).rejects.toThrow(
    /can't be used as text/,
  );
  expect(await evalWith("tostring(5)", {})).toBe("5");
});

test("distinct queries keep separate widgets that serialise alike", async () => {
  const env = new LuaEnv(luaBuildStandardEnv());
  env.set(
    "mk",
    new LuaNativeJSFunction(
      // Like DOM nodes and closures, nothing distinguishes them in JSON
      (_label: string) => new LuaTable({ _isWidget: true, html: {} }),
    ),
  );
  const result = await evalExpression(
    parseExpressionString(
      'query[[from r = {{n="a"}, {n="b"}} select mk(r.n)]]',
    ),
    env,
    LuaStackFrame.createWithGlobalEnv(env),
  );
  expect((result as LuaTable).length).toBe(2);
});

const live = (value: unknown, refreshOn = ["index"]) =>
  new LuaTable({
    _isWidget: true,
    live: new LuaTable({ value, refreshOn: new LuaTable(refreshOn) }),
  } as any);

test("liveOf reads Lua and JS wrappers", () => {
  expect(liveOf(live(3))).toEqual({ value: 3, refreshOn: ["index"] });
  expect(
    liveOf({ _isWidget: true, live: { value: 3, refreshOn: ["edit"] } }),
  ).toEqual({ value: 3, refreshOn: ["edit"] });
  expect(liveOf({ _isWidget: true, markdown: "x" })).toBeUndefined();
  expect(liveOf(3)).toBeUndefined();
});
