import { expect, test } from "vitest";
import {
  LuaEnv,
  LuaStackFrame,
  type LuaTable,
} from "../../space_lua/runtime.ts";
import { luaBuildStandardEnv } from "../../space_lua/stdlib.ts";
import { evalExpression } from "../../space_lua/eval.ts";
import { parseExpressionString } from "../../space_lua/parse.ts";
import { PageScopes } from "../../space_lua/page_scope.ts";
import type { Client } from "../../client.ts";
import { planPageVarEdit } from "../../space_lua/page_var_edit.ts";
import { clientPageVarsDeps, pageVarsSyscalls } from "./page_vars.ts";

function setup(pages: Record<string, string>, currentPage?: string) {
  const spaceEnv = new LuaEnv(luaBuildStandardEnv());
  const scopes = new PageScopes({
    readPageText: async (n) => (n in pages ? pages[n] : null),
    spaceEnv: () => spaceEnv,
  });
  const edits: string[] = [];
  const mapping = pageVarsSyscalls(scopes, {
    currentPage: () => currentPage,
    editPage: async (page, plan) => {
      if (!(page in pages))
        throw new Error(`pageVars.set: page ${page} not found`);
      const edit = plan(pages[page]);
      if (!edit) return;
      edits.push(page);
      pages[page] =
        pages[page].slice(0, edit.from) +
        edit.insert +
        pages[page].slice(edit.to);
    },
  });
  const call = (name: string) => {
    const entry = mapping[name];
    return (typeof entry === "function" ? entry : entry.callback) as (
      ctx: { sf: LuaStackFrame },
      ...args: any[]
    ) => Promise<any>;
  };
  const pageVars = call("lua:pageVars.get") as (
    ctx: { sf: LuaStackFrame },
    page?: string,
  ) => Promise<LuaTable>;
  const setVar = call("lua:pageVars.set");
  const sf = LuaStackFrame.createWithGlobalEnv(spaceEnv, null);
  return { pageVars, setVar, sf, pages, edits };
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
    "pageVars.get: page Nope not found",
  );
  await expect(pageVars({ sf }, "Bad")).rejects.toThrow(
    /pageVars\.get: Bad has failing definitions \(x: /,
  );
});

test("reports reads to the thread's tracker", async () => {
  const { pageVars, sf } = setup({ Budget: "${salary = 500}" });
  const seen: string[] = [];
  sf.threadState.pageScope = { chain: [] };
  sf.threadState.track = (e) => seen.push(e);
  await pageVars({ sf }, "Budget");
  expect(seen).toEqual(["pageScope:changed:Budget"]);
});

test("detects cycles through the build chain", async () => {
  const { pageVars, sf } = setup({ Budget: "${salary = 500}" });
  sf.threadState.pageScope = { chain: ["Forecast", "Budget"] };
  await expect(pageVars({ sf }, "Budget")).rejects.toThrow(
    "pageVars.get: cycle Forecast → Budget → Budget",
  );
});

test("reports a read before resolving, even when the page is missing", async () => {
  const { pageVars, sf } = setup({});
  const seen: string[] = [];
  sf.threadState.pageScope = { chain: [] };
  sf.threadState.track = (e) => seen.push(e);
  await expect(pageVars({ sf }, "Forecast")).rejects.toThrow("not found");
  expect(seen).toEqual(["pageScope:changed:Forecast"]);
});

test("get without a page reads the page the code runs on, then the open page", async () => {
  const { pageVars, sf } = setup(
    { Budget: "${salary = 500}", Open: "${salary = 1}" },
    "Open",
  );
  expect(await (await pageVars({ sf })).get("salary", sf)).toBe(1);
  sf.threadLocal.setLocal("sourcePage", { name: "Budget" });
  expect(await (await pageVars({ sf })).get("salary", sf)).toBe(500);
});

test("without any page to default to, get and set fail", async () => {
  const { pageVars, setVar, sf } = setup({});
  await expect(pageVars({ sf })).rejects.toThrow("pageVars: no current page");
  await expect(setVar({ sf }, "x", 1)).rejects.toThrow(
    "pageVars: no current page",
  );
});

test("set rewrites the cell on the page the code runs on, or the given page", async () => {
  const { setVar, sf, pages, edits } = setup(
    { Budget: "${rate = 0.1}", Other: "x ${rate = 1}" },
    "Other",
  );
  sf.threadLocal.setLocal("sourcePage", { name: "Budget" });
  await setVar({ sf }, "rate", 0.25);
  expect(pages.Budget).toBe("${rate = 0.25}");
  await setVar({ sf }, "rate", 2, "Other");
  expect(pages.Other).toBe("x ${rate = 2}");
  await setVar({ sf }, "rate", 2, "Other");
  expect(edits).toEqual(["Budget", "Other"]);
});

test("set reports a formula cell", async () => {
  const { setVar, sf } = setup({ Budget: "${t = 1 + 1}" }, "Budget");
  await expect(setVar({ sf }, "t", 3)).rejects.toThrow(
    "pageVars.set: t is a formula, not a value",
  );
});

test("editing another page re-plans once when it changed between reads", async () => {
  const texts = ["${rate = 1}", "x ${rate = 1}", "x ${rate = 1}"];
  const written: string[] = [];
  const client = {
    bootConfig: { readOnly: false },
    currentName: () => "Open",
    contentManager: { isDocumentEditor: () => false },
    space: {
      readPage: async () => ({ text: texts.shift() }),
      writePage: async (_page: string, text: string) => {
        written.push(text);
      },
    },
  } as unknown as Client;
  const deps = clientPageVarsDeps(client);
  await deps.editPage("Budget", (text) =>
    planPageVarEdit(text, "Budget", "rate", 2),
  );
  expect(written).toEqual(["x ${rate = 2}"]);
});

test("a read-only space refuses to set", async () => {
  const deps = clientPageVarsDeps({
    bootConfig: { readOnly: true },
  } as unknown as Client);
  await expect(deps.editPage("Budget", () => null)).rejects.toThrow(
    "pageVars.set: this space is read-only",
  );
});

// A client whose open page is `Open`, with per-page permissions
function permClient(perms: Record<string, "ro" | "rw">) {
  const written: string[] = [];
  const client = {
    bootConfig: { readOnly: false },
    currentName: () => "Open",
    currentPageMeta: () => ({ name: "Open", perm: perms.Open }),
    contentManager: { isDocumentEditor: () => false },
    space: {
      readPage: async (name: string) => ({
        text: "${rate = 1}",
        meta: { name, perm: perms[name] },
      }),
      getPageMeta: async (name: string) => ({ name, perm: perms[name] }),
      writePage: async (name: string) => {
        written.push(name);
      },
    },
  } as unknown as Client;
  return { deps: clientPageVarsDeps(client), written };
}

const setRate = (text: string) => planPageVarEdit(text, "X", "rate", 2);

test("a read-only target page refuses, whatever the open page is", async () => {
  const { deps, written } = permClient({ Open: "rw", Locked: "ro" });
  await expect(deps.editPage("Locked", setRate)).rejects.toThrow(
    "pageVars.set: Locked is read-only",
  );
  expect(written).toEqual([]);
});

test("a read-only open page doesn't block setting a writable page", async () => {
  const { deps, written } = permClient({ Open: "ro", Budget: "rw" });
  await deps.editPage("Budget", setRate);
  expect(written).toEqual(["Budget"]);
});

test("the variables table prints and iterates like a table, still read-only", async () => {
  const { pageVars, sf } = setup({ Budget: "${a = 1} ${b = 2}" });
  const t = await pageVars({ sf }, "Budget");
  const env = new LuaEnv(luaBuildStandardEnv());
  env.setLocal("t", t);
  const run = (src: string) =>
    evalExpression(
      parseExpressionString(src),
      env,
      LuaStackFrame.createWithGlobalEnv(env),
    );
  expect(await run("tostring(t)")).toMatch(/a = 1.*b = 2|b = 2.*a = 1/);
  expect(
    await run(
      "(function() local s = 0 for _, v in pairs(t) do s = s + v end return s end)()",
    ),
  ).toBe(3);
  await expect(assign(t, "a", sf)).rejects.toThrow(
    "page scope of Budget is read-only",
  );
});

test("a read-only open page refuses to set its own variables", async () => {
  const { deps } = permClient({ Open: "ro" });
  await expect(deps.editPage("Open", setRate)).rejects.toThrow(
    "pageVars.set: Open is read-only",
  );
});
