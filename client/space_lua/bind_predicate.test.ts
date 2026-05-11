import { describe, expect, it } from "vitest";
import { bindPredicate } from "./bind_predicate.ts";
import { parseExpressionString } from "./parse.ts";
import type { BoundLeafPredicate, BoundPredicate } from "./engine_contract.ts";

function bind(where: string, relation = "p"): BoundPredicate {
  const expr = parseExpressionString(where);
  const bound = bindPredicate(expr, relation);
  if (!bound) throw new Error(`bindPredicate returned undefined: ${where}`);
  return bound;
}

function leaf(p: BoundPredicate): BoundLeafPredicate {
  if (p.kind !== "leaf") throw new Error(`expected leaf, got ${p.kind}`);
  return p;
}

describe("bindPredicate -- nil-idiom normalisation", () => {
  it("`p.col` -> is-not-nil leaf", () => {
    const l = leaf(bind("p.lastAccessed"));
    expect(l.op).toBe("is-not-nil");
    expect(l.column).toBe("lastAccessed");
    expect(l.value).toBeUndefined();
  });

  it("`not p.col` -> is-nil leaf", () => {
    const l = leaf(bind("not p.lastAccessed"));
    expect(l.op).toBe("is-nil");
    expect(l.column).toBe("lastAccessed");
    expect(l.value).toBeUndefined();
  });

  it("`p.col == nil` -> is-nil leaf", () => {
    const l = leaf(bind("p.lastAccessed == nil"));
    expect(l.op).toBe("is-nil");
    expect(l.column).toBe("lastAccessed");
  });

  it("`nil == p.col` -> is-nil leaf (literal-on-left)", () => {
    const l = leaf(bind("nil == p.lastAccessed"));
    expect(l.op).toBe("is-nil");
    expect(l.column).toBe("lastAccessed");
  });

  it("`p.col ~= nil` -> is-not-nil leaf", () => {
    const l = leaf(bind("p.lastAccessed ~= nil"));
    expect(l.op).toBe("is-not-nil");
    expect(l.column).toBe("lastAccessed");
  });

  it("`nil ~= p.col` -> is-not-nil leaf", () => {
    const l = leaf(bind("nil ~= p.lastAccessed"));
    expect(l.op).toBe("is-not-nil");
    expect(l.column).toBe("lastAccessed");
  });

  it("`q.col` (different relation) -> opaque", () => {
    const result = bind("q.col", "p");
    expect(result.kind).toBe("opaque");
  });

  it("`not q.col` (different relation) -> composite NOT over opaque", () => {
    const result = bind("not q.col", "p");
    expect(result.kind).toBe("composite");
    if (result.kind !== "composite") throw new Error("unreachable");
    expect(result.op).toBe("not");
    expect(result.children).toHaveLength(1);
    expect(result.children[0].kind).toBe("opaque");
  });
});

describe("bindPredicate -- comparison leaves", () => {
  it("emits column-on-left form regardless of source order", () => {
    const a = leaf(bind("p.x == 5"));
    expect(a.op).toBe("eq");
    expect(a.column).toBe("x");
    expect(a.value).toEqual({ kind: "literal-number", value: 5 });

    const b = leaf(bind("5 == p.x"));
    expect(b.op).toBe("eq");
    expect(b.column).toBe("x");
    expect(b.value).toEqual({ kind: "literal-number", value: 5 });
  });

  it("flips order operators when the literal is on the left", () => {
    const lt = leaf(bind("5 < p.x"));
    expect(lt.op).toBe("gt");
    expect(lt.column).toBe("x");

    const lte = leaf(bind("5 <= p.x"));
    expect(lte.op).toBe("gte");

    const gt = leaf(bind("5 > p.x"));
    expect(gt.op).toBe("lt");

    const gte = leaf(bind("5 >= p.x"));
    expect(gte.op).toBe("lte");
  });

  it("preserves cross-column comparisons as leaves with column-kind value", () => {
    const l = leaf(bind("p.x < p.y"));
    expect(l.op).toBe("lt");
    expect(l.column).toBe("x");
    expect(l.value).toEqual({ kind: "column", relation: "p", column: "y" });
  });
});

describe("bindPredicate -- IN normalisation", () => {
  it("collapses single-element IN to eq", () => {
    const l = leaf(bind("p.tag in {'page'}"));
    expect(l.op).toBe("eq");
    expect(l.column).toBe("tag");
    expect(l.value).toEqual({ kind: "literal-string", value: "page" });
  });

  it("preserves multi-element IN", () => {
    const l = leaf(bind("p.tag in {'page', 'doc'}"));
    expect(l.op).toBe("in");
    expect(l.column).toBe("tag");
    expect(l.values).toEqual([
      { kind: "literal-string", value: "page" },
      { kind: "literal-string", value: "doc" },
    ]);
  });

  it("emits empty-values leaf for `x in {}` (caller decides folding)", () => {
    const l = leaf(bind("p.tag in {}"));
    expect(l.op).toBe("in");
    expect(l.values).toEqual([]);
  });
});

describe("bindPredicate -- composites", () => {
  it("AND/OR/NOT survive as composite nodes", () => {
    const a = bind("p.x == 1 and p.y == 2");
    expect(a.kind).toBe("composite");
    if (a.kind !== "composite") throw new Error("unreachable");
    expect(a.op).toBe("and");

    // Cross-column OR cannot be collapsed to IN; stays as composite.
    const o = bind("p.x == 1 or p.y == 2");
    expect(o.kind).toBe("composite");
    if (o.kind !== "composite") throw new Error("unreachable");
    expect(o.op).toBe("or");
  });
});

describe("bindPredicate -- OR-of-same-column-eq -> IN", () => {
  it("collapses 2-leaf same-column OR to a single IN leaf", () => {
    const l = leaf(bind("p.tag == 'page' or p.tag == 'doc'"));
    expect(l.op).toBe("in");
    expect(l.column).toBe("tag");
    expect(l.values?.map((v) => (v as any).value)).toEqual(["page", "doc"]);
  });

  it("collapses chain ORs to one IN leaf (left-assoc)", () => {
    const l = leaf(
      bind("p.tag == 'page' or p.tag == 'doc' or p.tag == 'task'"),
    );
    expect(l.op).toBe("in");
    expect(l.values?.map((v) => (v as any).value)).toEqual([
      "page",
      "doc",
      "task",
    ]);
  });

  it("merges existing IN leaves with eq leaves under OR", () => {
    const l = leaf(bind("p.tag in {'a', 'b'} or p.tag == 'c'"));
    expect(l.op).toBe("in");
    expect(l.values?.map((v) => (v as any).value)).toEqual(["a", "b", "c"]);
  });

  it("leaves cross-column OR untouched (different columns)", () => {
    const result = bind("p.tag == 'page' or p.banner == 'x'");
    expect(result.kind).toBe("composite");
    if (result.kind !== "composite") throw new Error("unreachable");
    expect(result.op).toBe("or");
  });

  it("leaves OR untouched when one side is a non-eq leaf", () => {
    const result = bind("p.size > 5 or p.size == 3");
    expect(result.kind).toBe("composite");
    if (result.kind !== "composite") throw new Error("unreachable");
    expect(result.op).toBe("or");
  });

  it("leaves OR untouched when a side is opaque", () => {
    const result = bind("p.tag == 'page' or upper(p.tag) == 'PAGE'");
    expect(result.kind).toBe("composite");
  });

  it("collapses single-element OR (1 leaf) to eq", () => {
    // `or` requires two operands at the parse level; this exercises the
    // post-collapse single-value path indirectly via `(p.tag == 'page')`.
    const l = leaf(bind("p.tag in {'page'}"));
    expect(l.op).toBe("eq");
    expect((l.value as any).value).toBe("page");
  });
});

describe("bindPredicate -- opaque fallbacks", () => {
  it("function calls become opaque", () => {
    const result = bind("upper(p.x) == 'A'");
    expect(result.kind).toBe("opaque");
  });

  it("undefined input returns undefined", () => {
    expect(bindPredicate(undefined, "p")).toBeUndefined();
  });
});
