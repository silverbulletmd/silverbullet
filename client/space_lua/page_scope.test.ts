import { expect, test } from "vitest";
import { pageVarsSyscalls } from "../plugos/syscalls/page_vars.ts";
import type { EventHookT } from "@silverbulletmd/silverbullet/type/manifest";
import { EventInterest } from "../event_interest.ts";
import { EventHook } from "../plugos/hooks/event.ts";
import { System } from "../plugos/system.ts";
import {
  LuaBuiltinFunction,
  LuaEnv,
  LuaNativeJSFunction,
  type LuaStackFrame,
  LuaTable,
} from "./runtime.ts";
import { luaBuildStandardEnv } from "./stdlib.ts";
import { PageScopes, pageScopeChangedEvent } from "./page_scope.ts";

function setup(pages: Record<string, string>) {
  const spaceEnv = new LuaEnv(luaBuildStandardEnv());
  let reads = 0;
  const scopes = new PageScopes({
    readPageText: async (name) => {
      reads++;
      return name in pages ? pages[name] : null;
    },
    spaceEnv: () => spaceEnv,
  });
  return { scopes, spaceEnv, pages, reads: () => reads };
}

// The real `pageVars.get`, as a plain Lua function
function withPageVars(env: LuaEnv, scopes: PageScopes) {
  const pageVars = pageVarsSyscalls(scopes, {
    currentPage: () => undefined,
    editPage: async () => {},
  })["lua:pageVars.get"];
  const callback = (
    typeof pageVars === "function" ? pageVars : pageVars.callback
  ) as (ctx: { sf: LuaStackFrame }, page: string) => Promise<LuaTable>;
  const space = new LuaTable();
  void space.rawSet(
    "get",
    new LuaBuiltinFunction((sf, page: string) => callback({ sf }, page)),
  );
  env.setLocal("pageVars", space);
}

const budget = [
  "${salary = 500}",
  "```page-lua",
  "function raise(a) return a * (1 + rate) end",
  "```",
  "${rate = 0.1}",
].join("\n");

test("builds definitions top to bottom into a boundary env", async () => {
  const { scopes, spaceEnv } = setup({ Budget: budget });
  const scope = (await scopes.get("Budget"))!;
  expect(scope.assignments.get("salary")).toEqual({ value: 500 });
  expect(scope.assignments.get("rate")).toEqual({ value: 0.1 });
  expect(scope.env.get("raise")).toBeTruthy();
  expect(spaceEnv.variables.has("salary")).toBe(false);
  expect(spaceEnv.variables.has("raise")).toBe(false);
  expect(scope.firstError).toBeNull();
});

test("pages without definitions have no scope", async () => {
  const { scopes } = setup({ Plain: "Hello ${1 + 1}" });
  expect(await scopes.get("Plain")).toBeNull();
  expect(scopes.latest("Plain")).toEqual({ scope: null, needsBuild: false });
  expect(scopes.latest("Unknown").scope).toBeUndefined();
});

test("definitions see earlier definitions, not later ones", async () => {
  const { scopes } = setup({ P: "${b = a} ${a = 1} ${c = a + 1}" });
  const scope = (await scopes.get("P"))!;
  expect(scope.assignments.get("b")).toEqual({ value: null });
  expect(scope.assignments.get("c")).toEqual({ value: 2 });
});

test("errors are recorded per definition and the build continues", async () => {
  const { scopes } = setup({
    P: "${a = nil + 1}\n```page-lua\nerror('boom')\n```\n${b = 2}",
  });
  const scope = (await scopes.get("P"))!;
  expect("error" in scope.assignments.get("a")!).toBe(true);
  expect(scope.blockErrors.get(0)).toMatch(/boom/);
  expect(scope.assignments.get("b")).toEqual({ value: 2 });
  expect(scope.firstError).not.toBeNull();
  expect(scope.env.has("a")).toBe(false);
});

test("duplicate names are an error at every occurrence", async () => {
  const { scopes } = setup({ P: "${x = 1} ${x = 2}" });
  const scope = (await scopes.get("P"))!;
  expect(scope.assignments.get("x")).toEqual({
    error: "`x` is defined more than once on this page",
  });
  expect(scope.env.has("x")).toBe(false);
});

test("assigning a space global shadows it inside the page only", async () => {
  const { scopes, spaceEnv } = setup({
    P: "```page-lua\nprint = 5\n```",
  });
  const scope = (await scopes.get("P"))!;
  expect(scope.env.get("print")).toBe(5);
  expect(spaceEnv.get("print")).not.toBe(5);
});

test("a runaway block is stopped and later definitions are marked", async () => {
  const { scopes } = setup({
    P: "```page-lua\nwhile true do end\n```\n${after = 1}",
  });
  const scope = (await scopes.get("P"))!;
  expect(scope.blockErrors.get(0)).toMatch(/budget|too long|stopped/i);
  expect(scope.assignments.get("after")).toEqual({
    error: "stopped: budget exceeded",
  });
}, 20_000);

test("caches by fingerprint; prose edits do not rebuild", async () => {
  const { scopes, pages } = setup({ Budget: budget });
  const first = (await scopes.get("Budget"))!;
  pages.Budget = `Intro\n\n${budget}`;
  expect(await scopes.pageChanged("Budget")).toEqual([]);
  expect((await scopes.get("Budget"))!.key).toBe(first.key);

  pages.Budget = budget.replace("salary = 500", "salary = 600");
  expect(await scopes.pageChanged("Budget")).toEqual(["Budget"]);
  const second = (await scopes.get("Budget"))!;
  expect(second.key).not.toBe(first.key);
  expect(second.assignments.get("salary")).toEqual({ value: 600 });
});

test("concurrent gets share one build", async () => {
  const { scopes, reads } = setup({ Budget: budget });
  const [a, b] = await Promise.all([
    scopes.get("Budget"),
    scopes.get("Budget"),
  ]);
  expect(a).toBe(b);
  expect(reads()).toBe(1);
});

const forecast = "${y = pageVars.get('Budget').salary}";

test("invalidation is transitive over dependencies", async () => {
  const { scopes, pages, spaceEnv } = setup({
    Budget: budget,
    Forecast: forecast,
  });
  withPageVars(spaceEnv, scopes);
  await scopes.get("Budget");
  await scopes.get("Forecast");
  pages.Budget = budget.replace("500", "700");
  expect((await scopes.pageChanged("Budget")).sort()).toEqual([
    "Budget",
    "Forecast",
  ]);
  // The old scope stays on show until the rebuild lands
  const stale = scopes.latest("Forecast");
  expect(stale.scope?.assignments.get("y")).toEqual({ value: 500 });
  expect(stale.needsBuild).toBe(true);
  await scopes.get("Forecast");
  expect(scopes.latest("Forecast").needsBuild).toBe(false);
  expect(scopes.latest("Forecast").scope?.assignments.get("y")).toEqual({
    value: 700,
  });
});

test("reads through an uncached build count as the reader's own", async () => {
  const { scopes, pages, spaceEnv } = setup({
    Budget: budget,
    Forecast: forecast,
    Plan: "${z = pageVars.get('Forecast').y}",
  });
  withPageVars(spaceEnv, scopes);
  // Forecast is built nested in Plan's build, and never cached
  expect((await scopes.get("Plan"))!.deps).toEqual(
    new Set(["pageScope:changed:Forecast", "pageScope:changed:Budget"]),
  );
  pages.Budget = budget.replace("500", "700");
  expect(await scopes.pageChanged("Budget")).toEqual(["Budget", "Plan"]);
});

test("a scope stops depending on a page it no longer reads", async () => {
  const { scopes, pages, spaceEnv } = setup({
    Budget: budget,
    Forecast: forecast,
  });
  withPageVars(spaceEnv, scopes);
  await scopes.get("Forecast");
  pages.Forecast = "${y = 1}";
  await scopes.pageChanged("Forecast");
  await scopes.get("Forecast");
  pages.Budget = budget.replace("500", "700");
  expect(await scopes.pageChanged("Budget")).toEqual([]);
});

test("deleting a page invalidates its dependents", async () => {
  const { scopes, pages, spaceEnv } = setup({
    Budget: budget,
    Forecast: forecast,
  });
  withPageVars(spaceEnv, scopes);
  await scopes.get("Budget");
  await scopes.get("Forecast");
  delete pages.Budget;
  expect((await scopes.pageChanged("Budget")).sort()).toEqual([
    "Budget",
    "Forecast",
  ]);
});

test("a missing page rejects until it is created", async () => {
  const { scopes, pages, reads } = setup({});
  await expect(scopes.get("Nope")).rejects.toThrow(
    "pageVars.get: page Nope not found",
  );
  await expect(scopes.get("Nope")).rejects.toThrow("not found");
  expect(reads()).toBe(1);
  expect(scopes.latest("Nope")).toEqual({
    scope: undefined,
    needsBuild: false,
  });
  pages.Nope = "${v = 1}";
  expect(await scopes.pageChanged("Nope")).toEqual(["Nope"]);
  expect((await scopes.get("Nope"))!.assignments.get("v")).toEqual({
    value: 1,
  });
});

test("creating a page invalidates pages that tried to read it", async () => {
  const { scopes, pages, spaceEnv } = setup({ Forecast: forecast });
  withPageVars(spaceEnv, scopes);
  expect((await scopes.get("Forecast"))!.firstError).toMatch(/not found/);
  pages.Budget = budget;
  // Budget itself was only read nested, so it was never cached
  expect(await scopes.pageChanged("Budget")).toEqual(["Budget", "Forecast"]);
  expect((await scopes.get("Forecast"))!.assignments.get("y")).toEqual({
    value: 500,
  });
});

test("changes to unrelated, never-built pages are ignored without reading", async () => {
  const { scopes, reads } = setup({ Other: "${x = 1}" });
  expect(await scopes.pageChanged("Other")).toEqual([]);
  expect(reads()).toBe(0);
});

test("a cycle in the build chain is rejected without waiting", async () => {
  const { scopes } = setup({ Budget: budget });
  await expect(scopes.get("Budget", { chain: ["Budget"] })).rejects.toThrow(
    "pageVars.get: cycle Budget → Budget",
  );
});

test("keeps a bounded number of scopes, least recently used out", async () => {
  const pages: Record<string, string> = {};
  for (let i = 0; i <= 200; i++) pages[`P${i}`] = `\${v = ${i}}`;
  const { scopes } = setup(pages);
  for (let i = 0; i <= 200; i++) await scopes.get(`P${i}`);
  expect(scopes.latest("P0").scope).toBeUndefined();
  expect(scopes.latest("P1").scope).toBeTruthy();
});

test("clear drops everything", async () => {
  const { scopes } = setup({ Budget: budget });
  await scopes.get("Budget");
  scopes.clear();
  expect(scopes.latest("Budget").scope).toBeUndefined();
});

test("concurrent builds that read each other settle with cycle errors", async () => {
  const { scopes, spaceEnv } = setup({
    A: "${x = pageVars.get('B').y}",
    B: "${y = pageVars.get('A').x}",
  });
  withPageVars(spaceEnv, scopes);
  const [a, b] = await Promise.all([scopes.get("A"), scopes.get("B")]);
  const messages = [a!, b!].flatMap((s) =>
    [...s.assignments.values()].map((v) => ("error" in v ? v.error : "")),
  );
  expect(messages.some((m) => /cycle/.test(m))).toBe(true);
}, 5000);

function gated(pages: Record<string, string>) {
  const spaceEnv = new LuaEnv(luaBuildStandardEnv());
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const scopes = new PageScopes({
    readPageText: async (name) => {
      const text = name in pages ? pages[name] : null;
      await gate;
      return text;
    },
    spaceEnv: () => spaceEnv,
  });
  return { scopes, release, pages };
}

test("a page changed while its first build is in flight is not cached stale", async () => {
  const { scopes, release, pages } = gated({ P: "${v = 1}" });
  const first = scopes.get("P");
  pages.P = "${v = 2}";
  const changed = scopes.pageChanged("P");
  release();
  expect(await changed).toEqual(["P"]);
  await first;
  expect(scopes.latest("P").scope).toBeUndefined();
  expect((await scopes.get("P"))!.assignments.get("v")).toEqual({ value: 2 });
});

test("clear while a build is in flight drops the stale build", async () => {
  const { scopes, release, pages } = gated({ P: "${v = 1}" });
  const first = scopes.get("P");
  pages.P = "${v = 3}";
  scopes.clear();
  release();
  await first;
  expect(scopes.latest("P").scope).toBeUndefined();
  expect((await scopes.get("P"))!.assignments.get("v")).toEqual({ value: 3 });
});

test("page code can't clear the build chain through _CTX", async () => {
  const { scopes, spaceEnv } = setup({
    Budget: [
      "```page-lua",
      "_CTX._pageScopeChain = nil",
      "```",
      "${salary = pageVars.get('Budget').salary}",
    ].join("\n"),
  });
  withPageVars(spaceEnv, scopes);
  const scope = (await scopes.get("Budget"))!;
  const result = scope.assignments.get("salary")!;
  expect("error" in result && result.error).toMatch(/cycle Budget → Budget/);
}, 2000);

test("definitions see the page's frontmatter through _CTX.currentPage", async () => {
  const { scopes } = setup({
    Budget: "---\nrate: 5\n---\n${increase = _CTX.currentPage.rate}",
  });
  const scope = (await scopes.get("Budget"))!;
  expect(scope.assignments.get("increase")).toEqual({ value: 5 });
});

test("definitions see indexed page meta when it is available", async () => {
  const spaceEnv = new LuaEnv(luaBuildStandardEnv());
  const scopes = new PageScopes({
    readPageText: async () => "${owner = _CTX.currentPage.owner}",
    spaceEnv: () => spaceEnv,
    pageMeta: async (name) => ({ name, owner: "Ada" }),
  });
  const scope = (await scopes.get("Budget"))!;
  expect(scope.assignments.get("owner")).toEqual({ value: "Ada" });
});

test("functions called from definitions see the page through _CTX", async () => {
  const { scopes } = setup({
    Budget: [
      "---",
      "rate: 5",
      "---",
      "```page-lua",
      "function info() return _CTX.currentPage.name .. ':' .. _CTX.currentPage.rate end",
      "```",
      "${x = info()}",
    ].join("\n"),
  });
  const scope = (await scopes.get("Budget"))!;
  expect(scope.assignments.get("x")).toEqual({ value: "Budget:5" });
});

// Wired like ClientSystem: invalidations dispatch per-page scope events, so
// cascades run through events. `probe(ev)` reports ev and returns 1.
function fixture(pages: Record<string, string>) {
  const hook = new EventHook();
  new System<EventHookT>(undefined).addHook(hook);
  const spaceEnv = new LuaEnv(luaBuildStandardEnv());
  const notified: string[] = [];
  const scopes = new PageScopes({
    readPageText: async (name) => (name in pages ? pages[name] : null),
    spaceEnv: () => spaceEnv,
    interest: new EventInterest(hook),
    onInvalidated: (invalidated) => {
      notified.push(...invalidated);
      for (const p of invalidated) {
        void hook.dispatchEvent(pageScopeChangedEvent(p));
      }
    },
  });
  withPageVars(spaceEnv, scopes);
  spaceEnv.setLocal(
    "probe",
    new LuaNativeJSFunction({
      callback: () => 1,
      observe: (sf, args) => sf.threadState.track?.(String(args[0])),
    }),
  );
  return { scopes, hook, notified, spaceEnv };
}

test("a scope whose definitions queried a tag invalidates when that tag changes", async () => {
  const { scopes, hook, notified } = fixture({
    Totals: '${n = probe("index:tag:task")}',
  });
  await scopes.get("Totals");
  await hook.dispatchEvent("index:tag:task");
  expect(notified).toEqual(["Totals"]);
  expect(scopes.latest("Totals").needsBuild).toBe(true);
});

test("a reader of an invalidated scope is invalidated in turn", async () => {
  const { scopes, hook, notified } = fixture({
    Budget: '${salary = probe("index:tag:task") * 100}',
    Plan: '${total = pageVars.get("Budget").salary}',
  });
  await scopes.get("Plan");
  await scopes.get("Budget");
  await hook.dispatchEvent("index:tag:task");
  await new Promise((r) => setTimeout(r, 0));
  expect(notified).toEqual(expect.arrayContaining(["Budget", "Plan"]));
  expect(scopes.latest("Plan").needsBuild).toBe(true);
});

test("cycles still terminate when a dependency fires", async () => {
  const { scopes, hook } = fixture({
    A: '${a = probe("index:tag:x") + pageVars.get("B").b}',
    B: '${b = pageVars.get("A").a}',
  });
  await scopes.tryGet("A");
  await hook.dispatchEvent("index:tag:x");
  await new Promise((r) => setTimeout(r, 0));
  const rebuilt = await scopes.tryGet("A");
  expect(rebuilt?.firstError).toMatch(/cycle/);
});

test("evicted, replaced and cleared scopes release their listeners", async () => {
  const { scopes, hook } = fixture({
    Totals: '${n = probe("index:tag:task")}',
  });
  const base = hook.listenerCount();
  await scopes.get("Totals");
  expect(hook.listenerCount().names).toBeGreaterThan(base.names);
  scopes.clear();
  expect(hook.listenerCount()).toEqual(base);
  expect(scopes.size).toBe(0);
});

test("a scope that read a trigger name invalidates on the events it stands for", async () => {
  const { scopes, hook, notified } = fixture({
    Count: '${n = probe("index")}',
  });
  await scopes.get("Count");
  await hook.dispatchEvent("file:changed", "Other.md");
  expect(notified).toEqual(["Count"]);
});

test("an event between a build's read and its store still invalidates", async () => {
  const { scopes, hook, notified, spaceEnv } = fixture({
    Totals: '${n = fires("index:tag:task")}',
  });
  // Reads, then the index flushes that tag while the build is still running
  spaceEnv.setLocal(
    "fires",
    new LuaNativeJSFunction({
      callback: async (ev: string) => {
        await hook.dispatchEvent(ev);
        return 1;
      },
      observe: (sf, args) => sf.threadState.track?.(String(args[0])),
    }),
  );
  await scopes.get("Totals");
  expect(scopes.latest("Totals").needsBuild).toBe(true);
  expect(notified).toEqual(["Totals"]);
});
