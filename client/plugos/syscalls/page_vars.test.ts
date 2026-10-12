import { expect, test } from "vitest";
import {
  LuaEnv,
  LuaStackFrame,
  type LuaTable,
} from "../../space_lua/runtime.ts";
import { luaBuildStandardEnv } from "../../space_lua/stdlib.ts";
import { PageScopes } from "../../space_lua/page_scope.ts";
import { pageVarsSyscalls } from "./page_vars.ts";

function setup(pages: Record<string, string>) {
  const spaceEnv = new LuaEnv(luaBuildStandardEnv());
  const scopes = new PageScopes({
    readPageText: async (n) => (n in pages ? pages[n] : null),
    spaceEnv: () => spaceEnv,
  });
  const entry = pageVarsSyscalls(scopes)["lua:space.pageVars"];
  const pageVars = (typeof entry === "function" ? entry : entry.callback) as (
    ctx: { sf: LuaStackFrame },
    page: string,
  ) => Promise<LuaTable>;
  const sf = LuaStackFrame.createWithGlobalEnv(spaceEnv, null);
  return { pageVars, sf };
}

// LuaTable.set may return a value or a promise; normalise to a promise
const assign = (t: LuaTable, k: string, sf: LuaStackFrame) =>
  Promise.resolve().then(() => t.set(k, 1, sf));

test("returns the page's bindings", async () => {
  const { pageVars, sf } = setup({ Budget: "${salary = 500}" });
  const t = await pageVars({ sf }, "Budget");
  expect(await t.get("salary", sf)).toBe(500);
});

test("is read-only for existing and new keys", async () => {
  const { pageVars, sf } = setup({ Budget: "${salary = 500}" });
  const t = await pageVars({ sf }, "Budget");
  await expect(assign(t, "salary", sf)).rejects.toThrow(
    "page scope of Budget is read-only",
  );
  await expect(assign(t, "other", sf)).rejects.toThrow(
    "page scope of Budget is read-only",
  );
});

test("empty table for a page without definitions", async () => {
  const { pageVars, sf } = setup({ Plain: "hi" });
  const t = await pageVars({ sf }, "Plain");
  expect(await t.get("anything", sf)).toBeNull();
});

test("throws for a missing page and for failing definitions", async () => {
  const { pageVars, sf } = setup({ Bad: "${x = nil + 1}" });
  await expect(pageVars({ sf }, "Nope")).rejects.toThrow(
    "space.pageVars: page Nope not found",
  );
  await expect(pageVars({ sf }, "Bad")).rejects.toThrow(
    /space\.pageVars: Bad has failing definitions \(x: /,
  );
});

test("reports reads through the thread's page-scope frame", async () => {
  const { pageVars, sf } = setup({ Budget: "${salary = 500}" });
  const seen: string[] = [];
  sf.threadState.pageScope = { chain: [], onRead: (p) => seen.push(p) };
  await pageVars({ sf }, "Budget");
  expect(seen).toEqual(["Budget"]);
});

test("detects cycles through the build chain", async () => {
  const { pageVars, sf } = setup({ Budget: "${salary = 500}" });
  sf.threadState.pageScope = { chain: ["Forecast", "Budget"] };
  await expect(pageVars({ sf }, "Budget")).rejects.toThrow(
    "space.pageVars: cycle Forecast → Budget → Budget",
  );
});

test("reports a read before resolving, even when the page is missing", async () => {
  const { pageVars, sf } = setup({});
  const seen: string[] = [];
  sf.threadState.pageScope = { chain: [], onRead: (p) => seen.push(p) };
  await expect(pageVars({ sf }, "Forecast")).rejects.toThrow("not found");
  expect(seen).toEqual(["Forecast"]);
});
