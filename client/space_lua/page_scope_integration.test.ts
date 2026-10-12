import { expect, test } from "vitest";
import { LuaBuiltinFunction, LuaEnv, LuaTable } from "./runtime.ts";
import { luaBuildStandardEnv } from "./stdlib.ts";
import { PageScopes } from "./page_scope.ts";
import { pageVarsSyscalls } from "../plugos/syscalls/page_vars.ts";
import type { SyscallDefinition } from "../plugos/system.ts";

function envWithPageVars(scopes: PageScopes, spaceEnv: LuaEnv) {
  const cb = (
    pageVarsSyscalls(scopes, {
      currentPage: () => undefined,
      editPage: async () => {},
    })["lua:pageVars.get"] as SyscallDefinition
  ).callback;
  const space = new LuaTable();
  void space.rawSet(
    "get",
    new LuaBuiltinFunction({ callback: (sf, page) => cb({ sf }, page) }),
  );
  spaceEnv.setLocal("pageVars", space);
}

test("definitions can read other pages and cycles are reported", async () => {
  const spaceEnv = new LuaEnv(luaBuildStandardEnv());
  const pages: Record<string, string> = {
    Budget: "${salary = 500}",
    Forecast: '${next = pageVars.get("Budget").salary * 2}',
    Loop: '${y = 1} ${x = pageVars.get("Loop").y}',
  };
  const scopes = new PageScopes({
    readPageText: async (n) => (n in pages ? pages[n] : null),
    spaceEnv: () => spaceEnv,
  });
  envWithPageVars(scopes, spaceEnv);

  const forecast = (await scopes.get("Forecast"))!;
  expect(forecast.assignments.get("next")).toEqual({ value: 1000 });

  pages.Budget = "${salary = 600}";
  expect((await scopes.pageChanged("Budget")).sort()).toEqual([
    "Budget",
    "Forecast",
  ]);
  expect((await scopes.get("Forecast"))!.assignments.get("next")).toEqual({
    value: 1200,
  });

  const loop = (await scopes.get("Loop"))!;
  const x = loop.assignments.get("x") as { error: string };
  expect(x.error).toMatch(/cycle Loop → Loop/);
});
