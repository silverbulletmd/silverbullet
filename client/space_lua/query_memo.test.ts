import { expect, test } from "vitest";
import type { LuaExpression, LuaMemoExpression } from "./ast.ts";
import { evalExpression } from "./eval.ts";
import { parseExpressionString } from "./parse.ts";
import { prettyPrintExpression } from "./pretty_print.ts";
import { ArrayQueryCollection } from "./query_collection.ts";
import { memoizeRowInvariants } from "./query_memo.ts";
import { isPromise } from "./rp.ts";
import {
  LuaEnv,
  LuaNativeJSFunction,
  LuaStackFrame,
  LuaTable,
} from "./runtime.ts";
import { luaBuildStandardEnv } from "./stdlib.ts";

function counter(impl: () => any) {
  let n = 0;
  return {
    fn: new LuaNativeJSFunction(() => {
      n++;
      return impl();
    }),
    calls: () => n,
  };
}

function setup(impl: () => any) {
  const c = counter(impl);
  const env = new LuaEnv();
  env.set("count", c.fn);
  const inner = parseExpressionString("count()");
  const memo: LuaMemoExpression = {
    type: "Memo",
    expression: inner,
    cell: { state: "empty" },
    ctx: inner.ctx,
  };
  const run = () => evalExpression(memo, env, LuaStackFrame.lostFrame);
  return { c, memo, run };
}

test("memo evaluates inner once", async () => {
  const { c, run } = setup(() => 42);
  expect(await run()).toBe(42);
  expect(await run()).toBe(42);
  expect(await run()).toBe(42);
  expect(c.calls()).toBe(1);
});

test("memo resolves promise once and goes sync", async () => {
  const { c, run } = setup(() => Promise.resolve(7));
  const first = run();
  expect(isPromise(first)).toBe(true);
  expect(await first).toBe(7);
  const second = run();
  expect(isPromise(second)).toBe(false);
  expect(second).toBe(7);
  expect(c.calls()).toBe(1);
});

test("memo caches and rethrows sync errors", async () => {
  const { c, run } = setup(() => {
    throw new Error("boom");
  });
  await expect(async () => await run()).rejects.toThrow("boom");
  await expect(async () => await run()).rejects.toThrow("boom");
  expect(c.calls()).toBe(1);
});

test("memo caches and rethrows promise rejections", async () => {
  const { c, run } = setup(() => Promise.reject(new Error("boom")));
  await expect(async () => await run()).rejects.toThrow("boom");
  await expect(async () => await run()).rejects.toThrow("boom");
  expect(c.calls()).toBe(1);
});

test("memo shares one pending promise between concurrent evaluations", async () => {
  const { c, run } = setup(() => Promise.resolve(5));
  const results = await Promise.all([run(), run()]);
  expect(results).toEqual([5, 5]);
  expect(c.calls()).toBe(1);
});

test("pretty prints memo as its inner expression", () => {
  const { memo } = setup(() => 1);
  const inner: LuaExpression = memo.expression;
  expect(prettyPrintExpression(memo)).toBe(prettyPrintExpression(inner));
});

function rowsTables() {
  return ["a", "b", "c", "d", "e"].map(
    (name, i) => new LuaTable({ name, n: i + 1 }),
  );
}

function memoEnv() {
  const globals = luaBuildStandardEnv();
  const env = new LuaEnv(globals);
  // String methods (`s:startsWith`) resolve through `_GLOBAL` on the frame.
  const sf = LuaStackFrame.createWithGlobalEnv(globals);
  const lookup = counter(() => new LuaTable(["b", "d"]));
  const count = counter(() => 1);
  const prefix = counter(() => "c");
  const heavy = counter(() => true);
  const source = counter(() => new ArrayQueryCollection(rowsTables()));
  env.set("lookup", lookup.fn);
  env.set("count", count.fn);
  env.set("prefix", prefix.fn);
  env.set("heavy", heavy.fn);
  env.set("source", source.fn);
  env.set("rows", new ArrayQueryCollection(rowsTables()));
  return { env, sf, lookup, count, prefix, heavy, source };
}

async function runWhere(src: string) {
  const ctx = memoEnv();
  const where = memoizeRowInvariants(parseExpressionString(src), "p");
  const result = await new ArrayQueryCollection(rowsTables()).query(
    { objectVariable: "p", where },
    ctx.env,
    ctx.sf,
  );
  const names = result.map((r: LuaTable) => r.rawGet("name"));
  return { ...ctx, where, names };
}

type MemoHit = { memo: LuaMemoExpression; parent: any; insideFrom: boolean };

function findMemos(root: any): MemoHit[] {
  const hits: MemoHit[] = [];
  const walk = (node: any, parent: any, insideFrom: boolean) => {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child, parent, insideFrom);
      return;
    }
    if (node.type === "Memo") {
      hits.push({ memo: node, parent, insideFrom });
    }
    const inFrom = insideFrom || node.type === "From";
    for (const [key, child] of Object.entries(node)) {
      if (key === "ctx" || key === "cell") continue;
      walk(child, node, inFrom);
    }
  };
  walk(root, null, false);
  return hits;
}

function src(e: LuaExpression): string {
  return prettyPrintExpression(e);
}

test("caches invariant call", async () => {
  const r = await runWhere("table.includes(lookup(), p.name)");
  expect(r.names).toEqual(["b", "d"]);
  expect(r.lookup.calls()).toBe(1);
});

test("caches maximal subtree only", () => {
  const out = memoizeRowInvariants(
    parseExpressionString("#lookup() > p.n"),
    "p",
  );
  const memos = findMemos(out);
  expect(memos).toHaveLength(1);
  expect(src(memos[0].memo.expression)).toBe("#lookup()");
});

test("leaves cheap invariants alone", () => {
  for (const s of ["p.n > 1 + 2", "p.name == x"]) {
    const e = parseExpressionString(s);
    expect(memoizeRowInvariants(e, "p")).toBe(e);
  }
});

test("never caches row-dependent call", async () => {
  const r = await runWhere("count(p.n) > 0");
  expect(r.names).toHaveLength(5);
  expect(r.count.calls()).toBe(5);
});

test("caches invariant args of a row-dependent call", async () => {
  const r1 = await runWhere("p.name:startsWith(prefix())");
  expect(r1.names).toEqual(["c"]);
  expect(r1.prefix.calls()).toBe(1);
  const r2 = await runWhere("lookup()[p.n] ~= nil");
  expect(r2.names).toEqual(["a", "b"]);
  expect(r2.lookup.calls()).toBe(1);
  const hits = findMemos(r2.where);
  expect(hits.map((h) => src(h.memo.expression))).toEqual(["lookup()"]);
  expect(hits[0].parent.type).toBe("TableAccess");
  expect(hits[0].parent.object).toBe(hits[0].memo);
});

test("does not cache inside function bodies", async () => {
  const r1 = await runWhere("(function() return lookup() end)() ~= nil");
  expect(r1.names).toHaveLength(5);
  expect(r1.lookup.calls()).toBe(1);
  const r2 = await runWhere("(function(x) return x + count() end)(p.n) > 0");
  expect(r2.names).toHaveLength(5);
  expect(r2.count.calls()).toBe(5);
  expect(findMemos(r2.where)).toHaveLength(0);
});

test("nested loop variable is row-dependent", async () => {
  const r = await runWhere(
    "#query[[from t = rows where t.n == p.n and heavy(t.n)]] > 0",
  );
  expect(r.names).toHaveLength(5);
  expect(r.heavy.calls()).toBe(5);
  for (const { memo } of findMemos(r.where)) {
    expect(src(memo.expression)).not.toContain("heavy");
  }
});

test("nested invariant still cached", async () => {
  const r = await runWhere(
    "#query[[from t = rows where t.n == p.n and count() > 0]] > 0",
  );
  expect(r.names).toHaveLength(5);
  expect(r.count.calls()).toBe(1);
});

test("unbound nested query is opaque", () => {
  for (const s of [
    "#query[[from rows where n == p.n and heavy(n)]] > 0",
    "#query[[from a = rows, b = rows where a.n == p.n and heavy(b.n)]] > 0",
  ]) {
    const out = memoizeRowInvariants(parseExpressionString(s), "p");
    expect(findMemos(out).filter((h) => !h.insideFrom)).toHaveLength(0);
  }
});

test("shadowing in nested query is conservative", () => {
  const e = parseExpressionString("#query[[from p = rows where p.n > 0]] > 0");
  const out = memoizeRowInvariants(e, "p");
  expect(findMemos(out)).toHaveLength(0);
  expect(out).toBe(e);
});

test("existing memo is a leaf", () => {
  const once = memoizeRowInvariants(
    parseExpressionString("lookup() ~= nil and p.n > 0"),
    "p",
  );
  const [first] = findMemos(once);
  const twice = memoizeRowInvariants(once, "p");
  const hits = findMemos(twice);
  expect(hits).toHaveLength(1);
  expect(hits[0].memo).toBe(first.memo);

  const e = parseExpressionString("lookup() + count() > p.n") as any;
  const inner = e.left.left;
  const existing: LuaMemoExpression = {
    type: "Memo",
    expression: inner,
    cell: { state: "empty" },
    ctx: inner.ctx,
  };
  e.left.left = existing;
  const out = memoizeRowInvariants(e, "p");
  const outHits = findMemos(out);
  expect(outHits).toHaveLength(2);
  for (const h of outHits) {
    expect(h.memo.expression.type).not.toBe("Memo");
  }
  expect(outHits.some((h) => h.memo === existing)).toBe(true);
  expect(existing.expression).toBe(inner);
});

test("nested query clauses are all scanned", () => {
  for (const q of [
    "query[[from t = rows limit p.n]]",
    "query[[from t = rows offset p.n]]",
    "query[[from t = rows order by 1 using p]]",
    "query[[from t = rows order by 1 using function(a, b) return p.cmp(a, b) end]]",
    "query[[from t = rows select {x = p.n}]]",
    "query[[from t = rows group by p.n]]",
    "query[[from t = rows group by t.n having p.n > 0]]",
    "query[[from t = rows where t.n > p.n]]",
  ]) {
    const out = memoizeRowInvariants(parseExpressionString(`#${q} > 0`), "p");
    for (const { memo } of findMemos(out)) {
      expect(memo.expression.type).not.toBe("Query");
      expect(src(memo.expression)).not.toContain("query");
    }
  }
});

test("correlated subquery from is cached", async () => {
  const s = "#query[[from t = source() where t.n == p.n]] > 0";
  const memos = findMemos(memoizeRowInvariants(parseExpressionString(s), "p"));
  expect(memos).toHaveLength(1);
  expect(memos[0].insideFrom).toBe(true);
  expect(src(memos[0].memo.expression)).toBe("source()");
  const r = await runWhere(s);
  expect(r.names).toHaveLength(5);
  expect(r.source.calls()).toBe(1);
});

test("math.random is denylisted", () => {
  const out = memoizeRowInvariants(
    parseExpressionString("math.random() < 2 and lookup() ~= nil"),
    "p",
  );
  const memos = findMemos(out);
  expect(memos).toHaveLength(1);
  expect(src(memos[0].memo.expression)).toBe("lookup() ~= nil");
  const inBody = parseExpressionString(
    "(function() return math.random() end)() < 2",
  );
  expect(memoizeRowInvariants(inBody, "p")).toBe(inBody);
});

test("fresh cells per call", () => {
  const s = "#lookup() > p.n and table.includes(lookup(), p.name)";
  const e = parseExpressionString(s);
  const a = findMemos(memoizeRowInvariants(e, "p"));
  const b = findMemos(memoizeRowInvariants(e, "p"));
  expect(a).toHaveLength(2);
  expect(b).toHaveLength(2);
  for (let i = 0; i < a.length; i++) {
    expect(a[i].memo).not.toBe(b[i].memo);
    expect(a[i].memo.cell).not.toBe(b[i].memo.cell);
    expect(a[i].memo.cell.state).toBe("empty");
    expect(b[i].memo.cell.state).toBe("empty");
  }
  expect(e).toEqual(parseExpressionString(s));
});

test("uncorrelated nested query is cached whole", async () => {
  for (const s of [
    "#query[[from t = source() where t.n > 2]] > p.n",
    "#query[[from source() where n > 2]] > p.n",
    "#query[[from a = source(), b = rows where a.n == b.n and a.n > 2]] > p.n",
  ]) {
    const memos = findMemos(
      memoizeRowInvariants(parseExpressionString(s), "p"),
    );
    expect(memos).toHaveLength(1);
    const wrapped = memos[0].memo.expression as any;
    expect(wrapped.type).toBe("Unary");
    expect(wrapped.argument.type).toBe("Query");
    const r = await runWhere(s);
    expect(r.names).toEqual(["a", "b"]);
    expect(r.source.calls()).toBe(1);
  }
});

async function namesWithAndWithoutRewrite(s: string) {
  const run = async (rewrite: boolean) => {
    const ctx = memoEnv();
    ctx.env.set("odd", new LuaNativeJSFunction((k: number) => k % 2 === 1));
    const parsed = parseExpressionString(s);
    const where = rewrite ? memoizeRowInvariants(parsed, "p") : parsed;
    const result = await new ArrayQueryCollection(rowsTables()).query(
      { objectVariable: "p", where },
      ctx.env,
      ctx.sf,
    );
    return result.map((r: LuaTable) => r.rawGet("name"));
  };
  return { plain: await run(false), rewritten: await run(true) };
}

test("post-group-by clauses of a correlated nested query are not split", async () => {
  const r = await namesWithAndWithoutRewrite(
    "#query[[from t = rows where t.n <= p.n group by t.n having odd(key)]] >= 2",
  );
  expect(r.plain).toEqual(["c", "d", "e"]);
  expect(r.rewritten).toEqual(r.plain);
});

test("aggregates in a correlated nested select are not wrapped", async () => {
  for (const agg of ["count(1)", "count()"]) {
    const r = await namesWithAndWithoutRewrite(
      `(query[[from t = rows where t.n <= p.n select {c = ${agg}}]])[1].c >= 3`,
    );
    expect(r.plain).toEqual(["c", "d", "e"]);
    expect(r.rewritten).toEqual(r.plain);
  }
});

test("select keeps its derived column name in a correlated nested query", async () => {
  const s =
    "(query[[from t = rows where t.n == p.n select lookup(), t.name]])[1].lookup ~= nil";
  const r = await namesWithAndWithoutRewrite(s);
  expect(r.plain).toEqual(["a", "b", "c", "d", "e"]);
  expect(r.rewritten).toEqual(r.plain);
});

async function runQuery(src: string, ctx = memoEnv()) {
  const ast = parseExpressionString(src);
  const value: any = await evalExpression(ast, ctx.env, ctx.sf);
  const out: any[] = [];
  for (let i = 1; i <= value.length; i++) out.push(value.rawGet(i));
  return { ...ctx, ast, out };
}

test("query caches invariant where call", async () => {
  const r = await runQuery(
    "query[[from p = rows where table.includes(lookup(), p.name) select p.name]]",
  );
  expect(r.out).toEqual(["b", "d"]);
  expect(r.lookup.calls()).toBe(1);
});

test("short-circuit skips invariant", async () => {
  const r = await runQuery(
    "query[[from p = rows where p.n > 100 and lookup() ~= nil]]",
  );
  expect(r.out).toEqual([]);
  expect(r.lookup.calls()).toBe(0);
});

test("empty collection skips invariant", async () => {
  const ctx = memoEnv();
  ctx.env.set("empty", new ArrayQueryCollection([]));
  const r = await runQuery(
    "query[[from p = empty where lookup() ~= nil]]",
    ctx,
  );
  expect(r.out).toEqual([]);
  expect(r.lookup.calls()).toBe(0);
});

test("re-execution re-evaluates", async () => {
  const ctx = memoEnv();
  const ast = parseExpressionString(
    "query[[from p = rows where lookup() ~= nil]]",
  );
  await evalExpression(ast, ctx.env, ctx.sf);
  await evalExpression(ast, ctx.env, ctx.sf);
  expect(ctx.lookup.calls()).toBe(2);
});

test("correlated subquery source fetched once", async () => {
  const r = await runQuery(
    "query[[from p = rows where #query[[from t = source() where t.n == p.n]] > 0]]",
  );
  expect(r.out).toHaveLength(5);
  expect(r.source.calls()).toBe(1);
});

test("no binding is untouched", async () => {
  const r = await runQuery(
    "query[[from rows where table.includes(lookup(), name)]]",
  );
  expect(r.lookup.calls()).toBe(5);
});

test("math.random stays per row", async () => {
  const ctx = memoEnv();
  let randoms = 0;
  const math: LuaTable = ctx.env.get("math");
  await math.rawSet(
    "random",
    new LuaNativeJSFunction(() => {
      randoms++;
      return 0.5;
    }),
  );
  const r = await runQuery(
    "query[[from p = rows where count() >= 0 and math.random() >= 0]]",
    ctx,
  );
  expect(r.out).toHaveLength(5);
  expect(r.count.calls()).toBe(1);
  expect(randoms).toBe(5);
});

test("invariant error message unchanged", async () => {
  const src = "query[[from p = rows where p.n > 0 and missing.fn()]]";
  await expect(runQuery(src)).rejects.toThrow(
    "attempt to index a nil value (global 'missing'); hint: 'missing' is not defined; this query binds each row to 'p' (from p = ...)",
  );
});

test("filteredTag-style and-wrapping keeps memo", async () => {
  const ctx = memoEnv();
  const where: LuaExpression = {
    type: "Binary",
    operator: "and",
    left: parseExpressionString("p.n > 0"),
    right: memoizeRowInvariants(
      parseExpressionString("table.includes(lookup(), p.name)"),
      "p",
    ),
    ctx: {},
  };
  const result = await new ArrayQueryCollection(rowsTables()).query(
    { objectVariable: "p", where },
    ctx.env,
    ctx.sf,
  );
  expect(result.map((r: LuaTable) => r.rawGet("name"))).toEqual(["b", "d"]);
  expect(ctx.lookup.calls()).toBe(1);
});

async function errorMessage(src: string, ctx = memoEnv()) {
  try {
    await runQuery(src, ctx);
  } catch (e: any) {
    return String(e.message);
  }
  throw new Error("expected an error");
}

// The same expression with `p` as a plain local, so no memo is involved.
async function plainError(expr: string, ctx = memoEnv()) {
  return await errorMessage(
    `(function() local p = {n = 1, name = "a"}; return ${expr} end)()`,
    ctx,
  );
}

function cfgEnv(value: any) {
  const ctx = memoEnv();
  ctx.env.set("cfg", new LuaNativeJSFunction(() => value));
  return ctx;
}

test("nil error keeps its source name through a memoized index prefix", async () => {
  const plain = await plainError("cfg().tbl[p.n]", cfgEnv(new LuaTable()));
  expect(plain).toContain("(field 'tbl')");
  expect(
    await errorMessage(
      "query[[from p = rows where cfg().tbl[p.n]]]",
      cfgEnv(new LuaTable()),
    ),
  ).toBe(plain);
});

test("nil error keeps its source name through a memoized call prefix", async () => {
  const plain = await plainError("cfg().fn(p)", cfgEnv(new LuaTable()));
  expect(plain).toContain("(field 'fn')");
  expect(
    await errorMessage(
      "query[[from p = rows where cfg().fn(p)]]",
      cfgEnv(new LuaTable()),
    ),
  ).toBe(plain);
});

test("nil error keeps its source name through a memoized method receiver", async () => {
  const plain = await plainError("cfg().h:m(p)", cfgEnv(new LuaTable()));
  expect(plain).toContain("(field 'h')");
  expect(
    await errorMessage(
      "query[[from p = rows where cfg().h:m(p)]]",
      cfgEnv(new LuaTable()),
    ),
  ).toBe(plain);
});

test("s: notation hint survives a memoized prefix", async () => {
  const plain = await plainError(
    "cfg().s:startsWith(p.name)",
    cfgEnv(new LuaTable()),
  );
  expect(plain).toContain("hint: in s:startsWith");
  expect(
    await errorMessage(
      "query[[from p = rows where cfg().s:startsWith(p.name)]]",
      cfgEnv(new LuaTable()),
    ),
  ).toBe(plain);
});

test("cross-join queries are not rewritten", async () => {
  const r = await runQuery(
    "query[[from a = rows, b = rows where count() > 0 and a.n == b.n select a.n]]",
  );
  expect(r.out).toHaveLength(5);
  expect(r.count.calls()).toBe(25);
});
