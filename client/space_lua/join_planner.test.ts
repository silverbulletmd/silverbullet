import { describe, expect, it } from "vitest";
import {
  attachAnalyzeQueryOpStats,
  buildJoinTree,
  buildLeadingHintInfo,
  buildNormalizationInfoBySource,
  collectScanSourceOrder,
  computeResultColumns,
  executeAndInstrument,
  executeJoinTree,
  explainJoinTree,
  exprToDisplayString,
  exprToString,
  extractSingleSourceFilters,
  formatExplainOutput,
  formatPrunedConjuncts,
  normalizePushdownExpression,
  pruneAlwaysTrueConjuncts,
  stripOuterParens,
  stripUsedJoinPredicates,
  wrapPlanWithQueryOps,
  type ExplainNode,
  type JoinSource,
} from "./join_planner.ts";
import { parseExpressionString } from "./parse.ts";
import { LuaEnv, LuaStackFrame, LuaTable } from "./runtime.ts";
import { Config } from "../config.ts";
import type { LuaExpression } from "./ast.ts";

function analyzeOpts() {
  return {
    analyze: true,
    verbose: true,
    summary: false,
    costs: true,
    timing: false,
    hints: false,
  } as const;
}

function leafNamesInOrder(tree: any): string[] {
  const out: string[] = [];
  const walk = (n: any) => {
    if (n.kind === "leaf") {
      out.push(n.source.name);
      return;
    }
    walk(n.left);
    walk(n.right);
  };
  walk(tree);
  return out;
}

describe("wrapPlanWithQueryOps group NDV", () => {
  it("prefers accumulated post-join NDV over leaf source NDV", () => {
    const plan: ExplainNode = {
      nodeType: "HashJoin",
      startupCost: 0,
      estimatedCost: 100,
      estimatedRows: 1000,
      estimatedWidth: 10,
      children: [
        {
          nodeType: "Scan",
          source: "p",
          startupCost: 0,
          estimatedCost: 10,
          estimatedRows: 100,
          estimatedWidth: 5,
          children: [],
        },
        {
          nodeType: "Scan",
          source: "para",
          startupCost: 0,
          estimatedCost: 20,
          estimatedRows: 500,
          estimatedWidth: 5,
          children: [],
        },
      ],
    };

    const sourceStats = new Map([
      [
        "p",
        {
          rowCount: 100,
          avgColumnCount: 5,
          ndv: new Map([["name", 100]]),
        },
      ],
      [
        "para",
        {
          rowCount: 500,
          avgColumnCount: 5,
          ndv: new Map([["page", 100]]),
        },
      ],
    ]);

    const accumulatedNdv = new Map([
      ["p", new Map([["name", 37]])],
      ["para", new Map([["page", 37]])],
    ]);

    const wrapped = wrapPlanWithQueryOps(
      plan,
      {
        groupBy: [
          {
            expr: {
              type: "PropertyAccess",
              object: {
                type: "Variable",
                name: "p",
                ctx: {} as any,
              },
              property: "name",
              ctx: {} as any,
            },
          },
        ],
      },
      sourceStats as any,
      accumulatedNdv,
    );

    expect(wrapped.nodeType).toBe("Project");
    expect(wrapped.children.length).toBe(1);
    const groupNode = wrapped.children[0];
    expect(groupNode.nodeType).toBe("GroupAggregate");
    expect(groupNode.estimatedRows).toBe(37);
  });

  it("falls back to leaf source NDV when accumulated NDV is absent", () => {
    const plan: ExplainNode = {
      nodeType: "Scan",
      source: "p",
      startupCost: 0,
      estimatedCost: 10,
      estimatedRows: 100,
      estimatedWidth: 5,
      children: [],
    };

    const sourceStats = new Map([
      [
        "p",
        {
          rowCount: 100,
          avgColumnCount: 5,
          ndv: new Map([["name", 42]]),
        },
      ],
    ]);

    const wrapped = wrapPlanWithQueryOps(
      plan,
      {
        groupBy: [
          {
            expr: {
              type: "PropertyAccess",
              object: {
                type: "Variable",
                name: "p",
                ctx: {} as any,
              },
              property: "name",
              ctx: {} as any,
            },
          },
        ],
      },
      sourceStats as any,
      undefined,
    );

    expect(wrapped.nodeType).toBe("Project");
    expect(wrapped.children.length).toBe(1);
    const groupNode = wrapped.children[0];
    expect(groupNode.nodeType).toBe("GroupAggregate");
    expect(groupNode.estimatedRows).toBe(42);
  });
});

describe("wrapPlanWithQueryOps Sort key annotations", () => {
  const basePlan: ExplainNode = {
    nodeType: "Scan",
    source: "t",
    startupCost: 0,
    estimatedCost: 100,
    estimatedRows: 100,
    estimatedWidth: 5,
    children: [],
  };

  const sortOf = (n: ExplainNode): ExplainNode => {
    expect(n.nodeType).toBe("Project");
    expect(n.children.length).toBe(1);
    return n.children[0];
  };

  it("annotates plain asc sort key", () => {
    const wrapped = wrapPlanWithQueryOps(basePlan, {
      orderBy: [
        {
          expr: { type: "Variable", name: "name", ctx: {} as any },
          desc: false,
        },
      ],
    });
    const sort = sortOf(wrapped);
    expect(sort.nodeType).toBe("Sort");
    expect(sort.sortKeys).toEqual(["name"]);
  });

  it("annotates desc sort key", () => {
    const wrapped = wrapPlanWithQueryOps(basePlan, {
      orderBy: [
        {
          expr: { type: "Variable", name: "age", ctx: {} as any },
          desc: true,
        },
      ],
    });
    const sort = sortOf(wrapped);
    expect(sort.nodeType).toBe("Sort");
    expect(sort.sortKeys).toEqual(["age desc"]);
  });

  it("annotates nulls first", () => {
    const wrapped = wrapPlanWithQueryOps(basePlan, {
      orderBy: [
        {
          expr: { type: "Variable", name: "priority", ctx: {} as any },
          desc: false,
          nulls: "first",
        },
      ],
    });
    const sort = sortOf(wrapped);
    expect(sort.nodeType).toBe("Sort");
    expect(sort.sortKeys).toEqual(["priority nulls first"]);
  });

  it("annotates desc nulls last", () => {
    const wrapped = wrapPlanWithQueryOps(basePlan, {
      orderBy: [
        {
          expr: { type: "Variable", name: "score", ctx: {} as any },
          desc: true,
          nulls: "last",
        },
      ],
    });
    const sort = sortOf(wrapped);
    expect(sort.nodeType).toBe("Sort");
    expect(sort.sortKeys).toEqual(["score desc nulls last"]);
  });

  it("annotates using with function name", () => {
    const wrapped = wrapPlanWithQueryOps(basePlan, {
      orderBy: [
        {
          expr: { type: "Variable", name: "val", ctx: {} as any },
          desc: false,
          using: "my_cmp",
        },
      ],
    });
    const sort = sortOf(wrapped);
    expect(sort.nodeType).toBe("Sort");
    expect(sort.sortKeys).toEqual(["val using my_cmp"]);
  });

  it("annotates multiple keys with mixed options", () => {
    const wrapped = wrapPlanWithQueryOps(basePlan, {
      orderBy: [
        {
          expr: {
            type: "PropertyAccess",
            object: { type: "Variable", name: "p", ctx: {} as any },
            property: "name",
            ctx: {} as any,
          },
          desc: false,
        },
        {
          expr: {
            type: "PropertyAccess",
            object: { type: "Variable", name: "p", ctx: {} as any },
            property: "age",
            ctx: {} as any,
          },
          desc: true,
          nulls: "first",
        },
      ],
    });
    const sort = sortOf(wrapped);
    expect(sort.nodeType).toBe("Sort");
    expect(sort.sortKeys).toEqual(["p.name", "p.age desc nulls first"]);
  });

  it("stores orderBySpec with nulls and using", () => {
    const wrapped = wrapPlanWithQueryOps(basePlan, {
      orderBy: [
        {
          expr: { type: "Variable", name: "x", ctx: {} as any },
          desc: true,
          nulls: "last",
          using: "cmp_fn",
        },
      ],
    });
    const sort = sortOf(wrapped);
    expect(sort.orderBySpec).toEqual([
      {
        expr: { type: "Variable", name: "x", ctx: {} as any },
        desc: true,
        nulls: "last",
        using: "cmp_fn",
      },
    ]);
  });
});

function makeSource(
  name: string,
  items?: any[],
  extraNdv?: [string, number][],
): JoinSource {
  return {
    name,
    expression: parseExpressionString(name),
    stats: {
      rowCount: items?.length ?? 100,
      ndv: new Map<string, number>([
        ["id", 100],
        ["x", 100],
        ["y", 100],
        ["z", 100],
        ["price", 100],
        ["min_price", 100],
        ["max_price", 100],
        ["keep", 2],
        ["flag", 2],
        ...(extraNdv ?? []),
      ]),
      avgColumnCount: 4,
      statsSource: "computed-exact-small",
    },
  };
}

function testEnvWithSources(bindings: Record<string, any[]>): LuaEnv {
  const env = new LuaEnv();
  for (const [name, items] of Object.entries(bindings)) {
    env.setLocal(name, items);
  }
  return env;
}

describe("leading join order hints", () => {
  it("leading forces prefix while the remaining suffix is still optimized", () => {
    const sources: JoinSource[] = [
      {
        ...makeSource("a"),
        stats: {
          ...makeSource("a").stats!,
          rowCount: 1000,
        },
      },
      {
        ...makeSource("b"),
        stats: {
          ...makeSource("b").stats!,
          rowCount: 5,
        },
      },
      {
        ...makeSource("c"),
        stats: {
          ...makeSource("c").stats!,
          rowCount: 900,
        },
      },
      {
        ...makeSource("d"),
        stats: {
          ...makeSource("d").stats!,
          rowCount: 10,
        },
      },
    ];

    const tree = buildJoinTree(sources, ["a", "c"]);
    const order = leafNamesInOrder(tree);

    expect(order.slice(0, 2)).toEqual(["a", "c"]);
    expect(order.slice(2)).toEqual(["b", "d"]);
  });

  it("leading full list fixes the complete join order", () => {
    const sources: JoinSource[] = [
      {
        ...makeSource("a"),
        stats: {
          ...makeSource("a").stats!,
          rowCount: 1000,
        },
      },
      {
        ...makeSource("b"),
        stats: {
          ...makeSource("b").stats!,
          rowCount: 5,
        },
      },
      {
        ...makeSource("c"),
        stats: {
          ...makeSource("c").stats!,
          rowCount: 900,
        },
      },
    ];

    const tree = buildJoinTree(sources, ["c", "a", "b"]);
    const order = leafNamesInOrder(tree);

    expect(order).toEqual(["c", "a", "b"]);
  });

  it("leading preserves prefix and still allows hinted suffix choice", () => {
    const sources: JoinSource[] = [
      {
        ...makeSource("a"),
        stats: {
          ...makeSource("a").stats!,
          rowCount: 100,
        },
      },
      {
        ...makeSource("b"),
        stats: {
          ...makeSource("b").stats!,
          rowCount: 1000,
        },
      },
      {
        ...makeSource("c"),
        hint: {
          type: "JoinHint",
          kind: "loop",
          ctx: {} as any,
        },
        stats: {
          ...makeSource("c").stats!,
          rowCount: 2,
        },
      },
    ];

    const tree = buildJoinTree(sources, ["a"]);
    const order = leafNamesInOrder(tree);

    expect(order[0]).toBe("a");
    expect(order.slice(1)).toEqual(["c", "b"]);

    const joins: any[] = [];
    const collect = (n: any) => {
      if (n.kind === "join") {
        joins.push(n);
        collect(n.left);
        collect(n.right);
      }
    };
    collect(tree);

    const joinWithC = joins.find(
      (j) => j.right.kind === "leaf" && j.right.source.name === "c",
    );
    expect(joinWithC?.method).toBe("loop");
  });
});

describe("leading hint in explain output", () => {
  function sourcesForLeadingTest(): JoinSource[] {
    return [
      {
        ...makeSource("a"),
        stats: { ...makeSource("a").stats!, rowCount: 50 },
      },
      {
        ...makeSource("b"),
        stats: { ...makeSource("b").stats!, rowCount: 80 },
      },
      {
        ...makeSource("c"),
        stats: { ...makeSource("c").stats!, rowCount: 70 },
      },
      {
        ...makeSource("d"),
        stats: { ...makeSource("d").stats!, rowCount: 60 },
      },
      {
        ...makeSource("e"),
        stats: { ...makeSource("e").stats!, rowCount: 30 },
      },
      {
        ...makeSource("f"),
        stats: { ...makeSource("f").stats!, rowCount: 40 },
      },
    ];
  }

  function hintOpts() {
    return {
      analyze: false,
      verbose: true,
      summary: false,
      costs: true,
      timing: false,
      hints: true,
    } as const;
  }

  it("collectScanSourceOrder returns leaves in join-tree execution order", () => {
    const sources = sourcesForLeadingTest();
    const tree = buildJoinTree(sources, ["a", "c", "b"]);
    const plan = explainJoinTree(tree, hintOpts());
    const order = collectScanSourceOrder(plan);
    expect(order.slice(0, 3)).toEqual(["a", "c", "b"]);
    expect(order.slice(3).sort()).toEqual(["d", "e", "f"]);
  });

  it("buildLeadingHintInfo reports original, fixed prefix and planner-chosen suffix", () => {
    const sources = sourcesForLeadingTest();
    const original = sources.map((s) => s.name);
    const tree = buildJoinTree(sources, ["a", "c", "b"]);
    const plan = explainJoinTree(tree, hintOpts());

    const info = buildLeadingHintInfo(["a", "c", "b"], original, plan);
    expect(info).toBeDefined();
    expect(info!.original).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(info!.requested).toEqual(["a", "c", "b"]);
    expect(info!.fixed).toEqual(["a", "c", "b"]);
    expect(info!.plannerChosen.length).toBe(3);
    expect(info!.plannerChosen.sort()).toEqual(["d", "e", "f"]);
    expect(info!.finalOrder.length).toBe(6);
    expect(info!.finalOrder.slice(0, 3)).toEqual(["a", "c", "b"]);
  });

  it("buildLeadingHintInfo returns undefined when no leading clause is given", () => {
    const sources = sourcesForLeadingTest();
    const original = sources.map((s) => s.name);
    const tree = buildJoinTree(sources);
    const plan = explainJoinTree(tree, hintOpts());
    expect(buildLeadingHintInfo(undefined, original, plan)).toBeUndefined();
    expect(buildLeadingHintInfo([], original, plan)).toBeUndefined();
  });

  it("formatExplainOutput renders leading hint preamble when hints enabled", () => {
    const sources = sourcesForLeadingTest();
    const original = sources.map((s) => s.name);
    const tree = buildJoinTree(sources, ["a", "c", "b"]);
    const plan = explainJoinTree(tree, hintOpts());
    const rendered = formatExplainOutput(
      {
        plan,
        planningTimeMs: 0,
        leadingHint: buildLeadingHintInfo(["a", "c", "b"], original, plan),
      },
      hintOpts(),
    );

    expect(rendered).toMatch(
      /Source Order: a,c,b,[def],[def],[def]\s{2}\(original=a,b,c,d,e,f hinted=a,c,b completed=[def],[def],[def]\)/,
    );
    // None of the legacy multi-line labels should appear.
    expect(rendered.includes("Leading Hint")).toBe(false);
    expect(rendered.includes("Requested:")).toBe(false);
    expect(rendered.includes("Fixed by hint:")).toBe(false);
    expect(rendered.includes("Planner-chosen:")).toBe(false);
    expect(rendered.includes("Final order:")).toBe(false);
  });

  it("formatExplainOutput omits completed= when the leading hint fully fixes the order", () => {
    const sources = sourcesForLeadingTest();
    const original = sources.map((s) => s.name);
    const fullHint = ["a", "c", "b", "d", "e", "f"];
    const tree = buildJoinTree(sources, fullHint);
    const plan = explainJoinTree(tree, hintOpts());
    const rendered = formatExplainOutput(
      {
        plan,
        planningTimeMs: 0,
        leadingHint: buildLeadingHintInfo(fullHint, original, plan),
      },
      hintOpts(),
    );

    expect(rendered).toContain(
      "Source Order: a,c,b,d,e,f  (original=a,b,c,d,e,f hinted=a,c,b,d,e,f)",
    );
    expect(rendered.includes("completed=")).toBe(false);
    expect(rendered.includes("(none)")).toBe(false);
  });

  it("leading hint preamble is omitted when hints option is disabled", () => {
    const sources = sourcesForLeadingTest();
    const original = sources.map((s) => s.name);
    const tree = buildJoinTree(sources, ["a", "c", "b"]);
    const plan = explainJoinTree(tree, {
      ...hintOpts(),
      hints: false,
    });
    const rendered = formatExplainOutput(
      {
        plan,
        planningTimeMs: 0,
        leadingHint: buildLeadingHintInfo(["a", "c", "b"], original, plan),
      },
      {
        ...hintOpts(),
        hints: false,
      },
    );

    expect(rendered.includes("Source Order:")).toBe(false);
    expect(rendered.includes("hinted=")).toBe(false);
  });

  it("leading hint preamble is omitted when no hint was given even if hints enabled", () => {
    const sources = sourcesForLeadingTest();
    const original = sources.map((s) => s.name);
    const tree = buildJoinTree(sources);
    const plan = explainJoinTree(tree, hintOpts());
    const rendered = formatExplainOutput(
      {
        plan,
        planningTimeMs: 0,
        leadingHint: buildLeadingHintInfo(undefined, original, plan),
      },
      hintOpts(),
    );

    expect(rendered.includes("Source Order:")).toBe(false);
  });

  it("leading hint no longer annotates the root node itself", () => {
    const sources = sourcesForLeadingTest();
    const tree = buildJoinTree(sources, ["a", "c", "b"]);
    const plan = wrapPlanWithQueryOps(explainJoinTree(tree, hintOpts()), {
      leading: ["a", "c", "b"],
    });

    const walk = (n: ExplainNode): boolean => {
      if ((n as any).leadingHint !== undefined) return true;
      return n.children.some(walk);
    };
    expect(walk(plan)).toBe(false);
  });
});

describe("join residual predicate stripping and explain", () => {
  it("strips consumed equi and cross-source residual predicates from WHERE", () => {
    const sources: JoinSource[] = [makeSource("a"), makeSource("b")];

    const where = parseExpressionString(
      "a.id == b.id and a.price > b.min_price and a.keep == 1",
    );

    const joinTree = buildJoinTree(
      sources,
      undefined,
      [
        {
          leftSource: "a",
          leftColumn: "id",
          rightSource: "b",
          rightColumn: "id",
        },
      ],
      [
        {
          leftSource: "a",
          leftColumn: "price",
          operator: ">",
          rightSource: "b",
          rightColumn: "min_price",
        },
      ],
      where,
    );

    const residual = stripUsedJoinPredicates(where, joinTree);
    expect(residual).toBeDefined();
    expect(JSON.stringify(residual)).toContain('"property":"keep"');
    expect(JSON.stringify(residual)).toContain('"value":1');
    expect(JSON.stringify(residual)).not.toContain('"min_price"');
    expect(JSON.stringify(residual)).not.toContain('"operator":">"');
  });

  it("does not strip single-source predicates from WHERE", () => {
    const sources: JoinSource[] = [makeSource("a"), makeSource("b")];

    const where = parseExpressionString(
      "a.id == b.id and a.price > b.min_price and a.keep == 1 and b.flag == true",
    );

    const joinTree = buildJoinTree(
      sources,
      undefined,
      [
        {
          leftSource: "a",
          leftColumn: "id",
          rightSource: "b",
          rightColumn: "id",
        },
      ],
      [
        {
          leftSource: "a",
          leftColumn: "price",
          operator: ">",
          rightSource: "b",
          rightColumn: "min_price",
        },
      ],
      where,
    );

    const residual = stripUsedJoinPredicates(where, joinTree);
    const residualText = JSON.stringify(residual);

    expect(residualText.includes('"keep"')).toBe(true);
    expect(residualText.includes('"flag"')).toBe(true);
    expect(residualText.includes('"min_price"')).toBe(false);
  });

  it("explain exposes join residual filter", () => {
    const sources: JoinSource[] = [makeSource("a"), makeSource("b")];

    const where = parseExpressionString(
      "a.id == b.id and a.price > b.min_price and a.keep == 1",
    );

    const joinTree = buildJoinTree(
      sources,
      undefined,
      [
        {
          leftSource: "a",
          leftColumn: "id",
          rightSource: "b",
          rightColumn: "id",
        },
      ],
      [
        {
          leftSource: "a",
          leftColumn: "price",
          operator: ">",
          rightSource: "b",
          rightColumn: "min_price",
        },
      ],
      where,
    );

    const explain = explainJoinTree(joinTree, {
      analyze: false,
      verbose: true,
      summary: false,
      costs: true,
      timing: false,
      hints: false,
    });

    expect(explain.joinResidualExprs).toEqual(["a.price > b.min_price"]);

    const rendered = formatExplainOutput(
      {
        plan: explain,
        planningTimeMs: 0,
      },
      {
        analyze: false,
        verbose: true,
        summary: false,
        costs: true,
        timing: false,
        hints: false,
      },
    );

    expect(
      rendered.includes("Residual Join Filter: a.price > b.min_price"),
    ).toBe(true);
    expect(rendered.includes("Hash Cond: a.id == b.id")).toBe(true);
  });

  it("multiple consumed residual conjuncts are all stripped from post-join WHERE", () => {
    const sources: JoinSource[] = [
      makeSource("a"),
      makeSource("b", undefined, [
        ["id", 100],
        ["min_price", 100],
        ["max_price", 100],
      ]),
    ];

    const where = parseExpressionString(
      "a.id == b.id and a.price > b.min_price and a.price <= b.max_price and a.keep == 1",
    );

    const joinTree = buildJoinTree(
      sources,
      undefined,
      [
        {
          leftSource: "a",
          leftColumn: "id",
          rightSource: "b",
          rightColumn: "id",
        },
      ],
      [
        {
          leftSource: "a",
          leftColumn: "price",
          operator: ">",
          rightSource: "b",
          rightColumn: "min_price",
        },
        {
          leftSource: "a",
          leftColumn: "price",
          operator: "<=",
          rightSource: "b",
          rightColumn: "max_price",
        },
      ],
      where,
    );

    const residual = stripUsedJoinPredicates(where, joinTree);
    expect(residual).toBeDefined();
    expect(JSON.stringify(residual)).toContain('"property":"keep"');
    expect(JSON.stringify(residual)).toContain('"value":1');
    expect(JSON.stringify(residual)).not.toContain('"min_price"');
    expect(JSON.stringify(residual)).not.toContain('"max_price"');

    const explain = explainJoinTree(joinTree, {
      analyze: false,
      verbose: true,
      summary: false,
      costs: true,
      timing: false,
      hints: false,
    });

    expect(explain.joinResidualExprs).toEqual([
      "a.price > b.min_price",
      "a.price <= b.max_price",
    ]);
  });

  it("assigns a residual predicate to the lowest covering join node in a three-source query", () => {
    const sources: JoinSource[] = [
      makeSource("a"),
      makeSource("b"),
      makeSource("c"),
    ];

    const where = parseExpressionString("a.x + b.y > 15");

    const joinTree = buildJoinTree(
      sources,
      undefined,
      undefined,
      undefined,
      where,
    );

    expect(joinTree.kind).toBe("join");
    if (joinTree.kind !== "join") {
      throw new Error("expected join root");
    }

    expect(joinTree.joinResiduals).toBeUndefined();

    expect(joinTree.left.kind).toBe("join");
    if (joinTree.left.kind !== "join") {
      throw new Error("expected lower join");
    }

    expect(joinTree.left.joinResiduals?.map((e) => JSON.stringify(e))).toEqual([
      JSON.stringify(where),
    ]);
  });
});

describe("single-source normalization metadata", () => {
  it("builds complete normalization info when all source-local conjuncts are pushable", () => {
    const expr = parseExpressionString("a.x == 1 and a.y == 2");
    const info = buildNormalizationInfoBySource(expr, new Set(["a", "b"]));

    expect(info.get("a")).toEqual({
      state: "complete",
      originalExpr: "(a.x == 1) and (a.y == 2)",
      normalizedExpr: "(a.x == 1) and (a.y == 2)",
      pushdownExpr: "(a.x == 1) and (a.y == 2)",
      leftoverExpr: "none",
    });
    expect(info.has("b")).toBe(false);
  });

  it("builds partial normalization info when a source-local leftover remains", () => {
    const expr = parseExpressionString("a.x == 1 and unknown_fn(a.y)");
    const info = buildNormalizationInfoBySource(expr, new Set(["a", "b"]));

    expect(info.get("a")).toEqual({
      state: "partial",
      originalExpr: "(a.x == 1) and unknown_fn(a.y)",
      normalizedExpr: "(a.x == 1) and unknown_fn(a.y)",
      pushdownExpr: "a.x == 1",
      leftoverExpr: "unknown_fn(a.y)",
    });
  });

  it("preserves user's original predicate when normalization rewrites it", () => {
    const expr = parseExpressionString("not (a.x in {1, 2}) and a.y == 3");
    const info = buildNormalizationInfoBySource(expr, new Set(["a"]));

    const entry = info.get("a");
    expect(entry).toBeDefined();
    expect(entry!.state).toBe("complete");
    expect(entry!.originalExpr).toContain("not");
    expect(entry!.originalExpr).toContain(" in ");
    expect(entry!.pushdownExpr).toContain("a.x ~= 1");
    expect(entry!.pushdownExpr).toContain("a.x ~= 2");
    expect(entry!.pushdownExpr).toContain("a.y == 3");
    expect(entry!.normalizedExpr).toContain("a.x ~= 1");
    expect(entry!.normalizedExpr).toContain("a.x ~= 2");
    expect(entry!.leftoverExpr).toBe("none");
  });

  it("explain leaf renders partial normalization lines", () => {
    const source = makeSource("a");
    const plan = explainJoinTree(
      { kind: "leaf", source },
      {
        analyze: false,
        verbose: true,
        summary: false,
        costs: true,
        timing: false,
        hints: false,
      },
      new Map([["a", "(a.x == 1)"]]),
      new Map([
        [
          "a",
          {
            state: "partial",
            originalExpr: "(a.x == 1) and unknown_fn(a.y)",
            normalizedExpr: "((a.x == 1) and unknown_fn(a.y))",
            pushdownExpr: "(a.x == 1)",
            leftoverExpr: "unknown_fn(a.y)",
          },
        ],
      ]),
    );

    expect(plan.normalizationState).toBe("partial");
    expect(plan.originalPredicateExpr).toBe("(a.x == 1) and unknown_fn(a.y)");
    expect(plan.normalizedPredicateExpr).toBe(
      "((a.x == 1) and unknown_fn(a.y))",
    );
    expect(plan.normalizedPushdownExpr).toBe("(a.x == 1)");
    expect(plan.normalizedLeftoverExpr).toBe("unknown_fn(a.y)");

    const rendered = formatExplainOutput(
      {
        plan,
        planningTimeMs: 0,
      },
      {
        analyze: false,
        verbose: true,
        summary: false,
        costs: true,
        timing: false,
        hints: false,
      },
    );

    expect(rendered.includes("Normalization: partial")).toBe(true);
    expect(
      rendered.includes("Original Predicate: (a.x == 1) and unknown_fn(a.y)"),
    ).toBe(true);
    expect(
      rendered.includes("Normalized Predicate: (a.x == 1) and unknown_fn(a.y)"),
    ).toBe(true);
    expect(rendered.includes("Normalized Pushdown: a.x == 1")).toBe(true);
    expect(rendered.includes("Normalized Leftover: unknown_fn(a.y)")).toBe(
      true,
    );
  });

  it("does not render normalization lines when no normalization metadata exists", () => {
    const source = makeSource("a");
    const plan = explainJoinTree(
      { kind: "leaf", source },
      {
        analyze: false,
        verbose: true,
        summary: false,
        costs: true,
        timing: false,
        hints: false,
      },
    );

    const rendered = formatExplainOutput(
      {
        plan,
        planningTimeMs: 0,
      },
      {
        analyze: false,
        verbose: true,
        summary: false,
        costs: true,
        timing: false,
        hints: false,
      },
    );

    expect(rendered.includes("Normalization:")).toBe(false);
    expect(rendered.includes("Pushdown:")).toBe(false);
    expect(rendered.includes("Leftover:")).toBe(false);
  });

  it("cross-source explain threads normalization metadata to matching scan leaves", () => {
    const sources: JoinSource[] = [makeSource("a"), makeSource("b")];

    const joinTree = buildJoinTree(sources);
    const normalizationInfo = buildNormalizationInfoBySource(
      parseExpressionString("a.x == 1 and unknown_fn(a.y) and b.flag == true"),
      new Set(["a", "b"]),
    );

    const explain = explainJoinTree(
      joinTree,
      {
        analyze: false,
        verbose: true,
        summary: false,
        costs: true,
        timing: false,
        hints: false,
      },
      new Map([
        ["a", "(a.x == 1)"],
        ["b", "(b.flag == true)"],
      ]),
      normalizationInfo,
    );

    const leaves: ExplainNode[] = [];
    const walk = (node: ExplainNode) => {
      if (node.nodeType === "Scan" || node.nodeType === "FunctionScan") {
        leaves.push(node);
      }
      for (const child of node.children) {
        walk(child);
      }
    };
    walk(explain);

    const aLeaf = leaves.find((l) => l.source === "a");
    const bLeaf = leaves.find((l) => l.source === "b");

    expect(aLeaf?.normalizationState).toBe("partial");
    expect(aLeaf?.normalizedPushdownExpr).toBe("a.x == 1");
    expect(aLeaf?.normalizedLeftoverExpr).toBe("unknown_fn(a.y)");
    expect(aLeaf?.originalPredicateExpr).toBe("(a.x == 1) and unknown_fn(a.y)");
    expect(aLeaf?.normalizedPredicateExpr).toBe(
      "(a.x == 1) and unknown_fn(a.y)",
    );

    expect(bLeaf?.normalizationState).toBe("complete");
    expect(bLeaf?.normalizedPushdownExpr).toBe("b.flag == true");
    expect(bLeaf?.normalizedLeftoverExpr).toBe("none");
    expect(bLeaf?.originalPredicateExpr).toBe("b.flag == true");
    expect(bLeaf?.normalizedPredicateExpr).toBe("b.flag == true");
  });

  it("renders original vs rewritten predicate lines for a scan leaf", () => {
    const source = makeSource("a");
    const normalizationInfo = buildNormalizationInfoBySource(
      parseExpressionString(
        "not (a.x in {1, 2}) and a.y == 3 and unknown_fn(a.z)",
      ),
      new Set(["a"]),
    );

    const plan = explainJoinTree(
      { kind: "leaf", source },
      {
        analyze: false,
        verbose: true,
        summary: false,
        costs: true,
        timing: false,
        hints: false,
      },
      undefined,
      normalizationInfo,
    );

    const rendered = formatExplainOutput(
      {
        plan,
        planningTimeMs: 0,
      },
      {
        analyze: false,
        verbose: true,
        summary: false,
        costs: true,
        timing: false,
        hints: false,
      },
    );

    expect(rendered).toContain("Original Predicate:");
    expect(rendered).toContain("not");
    expect(rendered).toContain(" in ");
    expect(rendered).toContain("Normalized Predicate:");
    expect(rendered).toMatch(/a\.x ~= 1[\s\S]*a\.x ~= 2/);
    expect(rendered).toContain("Normalized Pushdown:");
    expect(rendered).toContain("Normalized Leftover:");
    expect(rendered).toContain("unknown_fn(a.z)");
    expect(rendered).toContain("Normalization: partial");
  });
});

describe("formatExplainOutput node section ordering", () => {
  function requireOrder(rendered: string, labels: string[]): void {
    const indices = labels.map((label) => ({
      label,
      index: rendered.indexOf(label),
    }));
    for (const { label, index } of indices) {
      expect(index, `expected "${label}" to appear in output`).toBeGreaterThan(
        -1,
      );
    }
    for (let i = 1; i < indices.length; i++) {
      expect(
        indices[i].index,
        `expected "${indices[i].label}" after "${indices[i - 1].label}"`,
      ).toBeGreaterThan(indices[i - 1].index);
    }
  }

  function makeSourceWithPushdown(name: string): JoinSource {
    return {
      name,
      expression: parseExpressionString(name),
      stats: {
        rowCount: 100,
        ndv: new Map<string, number>([
          ["id", 100],
          ["x", 100],
          ["y", 100],
        ]),
        avgColumnCount: 4,
        statsSource: "computed-exact-small",
        executionCapabilities: {
          engines: [
            {
              id: "bitmap",
              name: "bitmap",
              kind: "bitmap",
              capabilities: [
                "scan-bitmap",
                "stage-where",
                "pred-eq",
                "pred-neq",
                "pred-in",
                "bool-and",
                "bool-not",
              ],
              baseCostWeight: 0.6,
              priority: 20,
            },
          ],
        },
      },
    };
  }

  it("join node pairs each condition/filter with its 'Rows Removed' stat in order", async () => {
    const aItems = [
      { id: 1, price: 5, keep: 1 },
      { id: 2, price: 20, keep: 1 },
      { id: 3, price: 30, keep: 1 },
    ];
    const bItems = [
      { id: 1, min_price: 10 },
      { id: 2, min_price: 10 },
      { id: 3, min_price: 50 },
    ];

    const sources: JoinSource[] = [
      {
        ...makeSource("a", aItems),
        hint: {
          type: "JoinHint",
          kind: "loop",
          ctx: {} as any,
        },
      },
      makeSource("b", bItems),
    ];

    const where = parseExpressionString(
      "a.id == b.id and a.price > b.min_price",
    );

    const joinTree = buildJoinTree(
      sources,
      undefined,
      [
        {
          leftSource: "a",
          leftColumn: "id",
          rightSource: "b",
          rightColumn: "id",
        },
      ],
      [
        {
          leftSource: "a",
          leftColumn: "price",
          operator: ">",
          rightSource: "b",
          rightColumn: "min_price",
        },
      ],
      where,
    );

    const explainOpts = {
      analyze: true,
      verbose: true,
      summary: false,
      costs: true,
      timing: false,
      hints: false,
    } as const;

    const plan = explainJoinTree(joinTree, explainOpts);
    const env = testEnvWithSources({ a: aItems, b: bItems });
    await executeAndInstrument(
      joinTree,
      plan,
      env,
      LuaStackFrame.lostFrame,
      explainOpts,
      undefined,
      undefined,
      0,
    );

    const rendered = formatExplainOutput(
      { plan, planningTimeMs: 0 },
      explainOpts,
    );

    // Join Filter (equi) -> Residual Join Filter -> Rows Removed by Join Filter
    requireOrder(rendered, [
      "Join Filter: a.id == b.id",
      "Residual Join Filter: a.price > b.min_price",
      "Rows Removed by Join Filter:",
    ]);
  });

  it("scan leaf orders: filter -> rows removed -> hints -> pushdown detail -> engine -> estimation", () => {
    const source = makeSourceWithPushdown("a");
    const plan = explainJoinTree(
      { kind: "leaf", source },
      {
        analyze: false,
        verbose: true,
        summary: false,
        costs: true,
        timing: false,
        hints: false,
      },
      new Map([["a", "(a.x == 1)"]]),
      new Map([
        [
          "a",
          {
            state: "partial",
            originalExpr: "(a.x == 1) and unknown_fn(a.y)",
            normalizedExpr: "((a.x == 1) and unknown_fn(a.y))",
            pushdownExpr: "(a.x == 1)",
            leftoverExpr: "unknown_fn(a.y)",
          },
        ],
      ]),
    );
    plan.rowsRemovedByFilter = 5;
    plan.actualRows = 10;

    const rendered = formatExplainOutput(
      { plan, planningTimeMs: 0 },
      {
        analyze: true,
        verbose: true,
        summary: false,
        costs: true,
        timing: false,
        hints: false,
      },
    );

    requireOrder(rendered, [
      "Pushdown Cond: a.x == 1",
      "Rows Removed by Pushdown Filter: 5",
      "Pushdown Capabilities:",
      "Normalization: partial",
      "Original Predicate:",
      "Normalized Predicate:",
      "Normalized Pushdown:",
      "Normalized Leftover:",
      "Execution Scan:",
      "Stats: computed-exact-small",
    ]);
  });

  it("GroupAggregate node orders its own lines: Group Key -> Aggregate -> Stats", () => {
    const basePlan: ExplainNode = {
      nodeType: "Scan",
      source: "t",
      startupCost: 0,
      estimatedCost: 100,
      estimatedRows: 100,
      estimatedWidth: 5,
      statsSource: "computed-exact-small",
      children: [],
    };

    const wrapped = wrapPlanWithQueryOps(
      basePlan,
      {
        groupBy: [{ expr: parseExpressionString("t.g") }],
        select: parseExpressionString("{ g = t.g, s = sum(t.v) }"),
      },
      undefined,
      undefined,
      undefined,
      new Config(),
    );

    const rendered = formatExplainOutput(
      { plan: wrapped, planningTimeMs: 0 },
      {
        analyze: false,
        verbose: true,
        summary: false,
        costs: true,
        timing: false,
        hints: false,
      },
    );

    const lines = rendered.split("\n");
    const start = lines.findIndex((l) => l.includes("Hash Aggregate"));
    expect(start).toBeGreaterThanOrEqual(0);
    const block = lines.slice(start, start + 10).join("\n");

    requireOrder(block, [
      "Hash Aggregate",
      "Group Key: t.g",
      "Aggregate: sum(t.v)",
      "Stats: computed-exact-small",
    ]);
  });

  it("Limit node exposes Count/Offset before operator stats", () => {
    const basePlan: ExplainNode = {
      nodeType: "Scan",
      source: "t",
      startupCost: 0,
      estimatedCost: 100,
      estimatedRows: 100,
      estimatedWidth: 5,
      statsSource: "computed-exact-small",
      children: [],
    };

    const wrapped = wrapPlanWithQueryOps(basePlan, {
      limit: 10,
      offset: 5,
    });

    const rendered = formatExplainOutput(
      { plan: wrapped, planningTimeMs: 0 },
      {
        analyze: false,
        verbose: true,
        summary: false,
        costs: true,
        timing: false,
        hints: false,
      },
    );

    requireOrder(rendered, ["Limit", "limit=10", "offset=5"]);
  });

  it("verbose section comes strictly after all non-verbose operator lines", () => {
    const source = makeSourceWithPushdown("a");
    const plan = explainJoinTree(
      { kind: "leaf", source },
      {
        analyze: true,
        verbose: true,
        summary: false,
        costs: true,
        timing: false,
        hints: true,
      },
      new Map([["a", "(a.x == 1)"]]),
      new Map([
        [
          "a",
          {
            state: "complete",
            originalExpr: "(a.x == 1)",
            normalizedExpr: "(a.x == 1)",
            pushdownExpr: "(a.x == 1)",
            leftoverExpr: "none",
          },
        ],
      ]),
    );
    plan.rowsRemovedByFilter = 3;
    plan.actualRows = 7;

    const rendered = formatExplainOutput(
      { plan, planningTimeMs: 0 },
      {
        analyze: true,
        verbose: true,
        summary: false,
        costs: true,
        timing: false,
        hints: true,
      },
    );

    requireOrder(rendered, [
      "Rows Removed by Pushdown Filter: 3",
      "Pushdown Capabilities:",
      "Normalization: complete",
      "Execution Scan:",
      "Stats:",
    ]);
  });
});

describe("expression paren normalization", () => {
  it("stripOuterParens removes one enclosing pair only", () => {
    expect(stripOuterParens("(a.x == 1)")).toBe("a.x == 1");
    expect(stripOuterParens("((a) and (b))")).toBe("(a) and (b)");
    expect(stripOuterParens("(a) or (b)")).toBe("(a) or (b)");
    expect(stripOuterParens("unknown_fn(x)")).toBe("unknown_fn(x)");
    expect(stripOuterParens("")).toBe("");
    expect(stripOuterParens("()")).toBe("");
  });

  it("exprToDisplayString drops the outermost parens from Binary expressions", () => {
    const expr = parseExpressionString("a.x == 1");
    expect(exprToString(expr)).toBe("(a.x == 1)");
    expect(exprToDisplayString(expr)).toBe("a.x == 1");
  });

  it("exprToDisplayString keeps nested parens intact", () => {
    const expr = parseExpressionString("(a.x == 1) and (a.y == 2)");
    expect(exprToString(expr)).toBe("((a.x == 1) and (a.y == 2))");
    expect(exprToDisplayString(expr)).toBe("(a.x == 1) and (a.y == 2)");
  });

  it("every expression surface in the rendered output is paren-free at the outer level", async () => {
    const aItems = [
      { id: 1, x: 1, y: 3, keep: true, price: 10 },
      { id: 2, x: 2, y: 3, keep: true, price: 20 },
      { id: 3, x: 5, y: 3, keep: false, price: 30 },
    ];
    const bItems = [
      { id: 1, min_price: 5 },
      { id: 2, min_price: 15 },
      { id: 3, min_price: 50 },
    ];

    const sources: JoinSource[] = [
      makeSource("a", aItems),
      makeSource("b", bItems),
    ];

    const where = parseExpressionString(
      "a.id == b.id and a.price > b.min_price and a.keep == true",
    );

    const joinTree = buildJoinTree(
      sources,
      undefined,
      [
        {
          leftSource: "a",
          leftColumn: "id",
          rightSource: "b",
          rightColumn: "id",
        },
      ],
      [
        {
          leftSource: "a",
          leftColumn: "price",
          operator: ">",
          rightSource: "b",
          rightColumn: "min_price",
        },
      ],
      where,
    );

    const residualWhere = stripUsedJoinPredicates(where, joinTree);

    const normInfo = buildNormalizationInfoBySource(where, new Set(["a", "b"]));
    const pushedByName = new Map<string, string>();
    for (const [name, info] of normInfo) {
      pushedByName.set(name, info.pushdownExpr);
    }

    const explainOpts = {
      analyze: false,
      verbose: true,
      summary: false,
      costs: false,
      timing: false,
      hints: false,
    } as const;

    const plan = wrapPlanWithQueryOps(
      explainJoinTree(joinTree, explainOpts, pushedByName, normInfo),
      {
        where: residualWhere,
        orderBy: [
          {
            expr: parseExpressionString("a.id"),
            desc: false,
          },
        ],
        groupBy: [{ expr: parseExpressionString("a.keep") }],
        select: parseExpressionString(
          "{ k = a.keep, total = sum(a.price) filter(where a.price > 5) }",
        ),
      },
      undefined,
      undefined,
      undefined,
      new Config(),
    );

    const rendered = formatExplainOutput(
      { plan, planningTimeMs: 0 },
      explainOpts,
    );

    const labelPrefixes = [
      "Filter",
      "Pushdown Cond",
      "Hash Cond",
      "Merge Cond",
      "Join Filter",
      "Residual Join Filter",
      "Original Predicate",
      "Normalized Predicate",
      "Normalized Pushdown",
      "Normalized Leftover",
    ];

    for (const line of rendered.split("\n")) {
      const trimmed = line.trim();
      for (const prefix of labelPrefixes) {
        const marker = `${prefix}: `;
        const idx = trimmed.indexOf(marker);
        if (idx !== 0) continue;
        const value = trimmed.slice(marker.length);
        expect(
          !(
            value.length >= 2 &&
            value.startsWith("(") &&
            value.endsWith(")") &&
            stripOuterParens(value) !== value
          ),
          `line "${line}" still has redundant outer parens`,
        ).toBe(true);
      }
    }

    expect(rendered).toContain("Sort Key: a.id");
    expect(rendered).toContain("Group Key: a.keep");
    expect(rendered).toContain(
      "Output: a.keep, sum(a.price) filter(a.price > 5)",
    );
    expect(rendered).toContain("Join Filter: a.id == b.id");
    expect(rendered).toContain("Residual Join Filter: a.price > b.min_price");
    expect(rendered).toContain("Filter: a.keep == true");
    expect(rendered).toContain("Pushdown Cond: a.keep == true");
    expect(rendered).toContain("Original Predicate: a.keep == true");
    expect(rendered).toContain("Normalized Predicate: a.keep == true");
    expect(rendered).toContain("Normalized Pushdown: a.keep == true");
    expect(rendered).toContain("Filter: sum(a.price) filter(a.price > 5)");
    expect(rendered).toContain("Aggregate: sum(a.price) filter(a.price > 5)");
  });
});

describe("Project Output: rendering for wildcard select fields", () => {
  function renderProjectOutputs(select: LuaExpression): string[] {
    const basePlan: ExplainNode = {
      nodeType: "NestedLoop",
      startupCost: 0,
      estimatedCost: 200,
      estimatedRows: 100,
      estimatedWidth: 10,
      children: [
        {
          nodeType: "Scan",
          source: "t",
          startupCost: 0,
          estimatedCost: 10,
          estimatedRows: 10,
          estimatedWidth: 5,
          children: [],
        },
        {
          nodeType: "Scan",
          source: "p",
          startupCost: 0,
          estimatedCost: 10,
          estimatedRows: 10,
          estimatedWidth: 5,
          children: [],
        },
      ],
    };

    const wrapped = wrapPlanWithQueryOps(basePlan, { select });
    const rendered = formatExplainOutput({ plan: wrapped, planningTimeMs: 0 }, {
      analyze: false,
      verbose: true,
      summary: false,
      costs: false,
      timing: false,
      hints: false,
    } as const);
    return rendered
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("Output:"))
      .slice(0, 1);
  }

  it("renders Output: * for select *", () => {
    const select: LuaExpression = {
      type: "TableConstructor",
      fields: [{ type: "StarField", ctx: {} as any }],
      ctx: {} as any,
    };
    expect(renderProjectOutputs(select)).toEqual(["Output: *"]);
  });

  it("renders Output: t.*, p.* for select t.*, p.*", () => {
    const select: LuaExpression = {
      type: "TableConstructor",
      fields: [
        { type: "StarSourceField", source: "t", ctx: {} as any },
        { type: "StarSourceField", source: "p", ctx: {} as any },
      ],
      ctx: {} as any,
    };
    expect(renderProjectOutputs(select)).toEqual(["Output: t.*, p.*"]);
  });

  it("renders Output: *.title for select *.title", () => {
    const select: LuaExpression = {
      type: "TableConstructor",
      fields: [{ type: "StarColumnField", column: "title", ctx: {} as any }],
      ctx: {} as any,
    };
    expect(renderProjectOutputs(select)).toEqual(["Output: *.title"]);
  });

  it("renders Output: t.*, x = a.b for mixed wildcard + named field", () => {
    const select: LuaExpression = {
      type: "TableConstructor",
      fields: [
        { type: "StarSourceField", source: "t", ctx: {} as any },
        {
          type: "PropField",
          key: "x",
          value: {
            type: "PropertyAccess",
            object: { type: "Variable", name: "a", ctx: {} as any },
            property: "b",
            ctx: {} as any,
          },
          ctx: {} as any,
        },
      ],
      ctx: {} as any,
    };
    expect(renderProjectOutputs(select)).toEqual(["Output: t.*, a.b"]);
  });
});

describe("join residual execution", () => {
  it("hash join applies residual predicate during execution", async () => {
    const aItems = [
      { id: 1, price: 5, keep: 1 },
      { id: 2, price: 20, keep: 1 },
    ];
    const bItems = [
      { id: 1, min_price: 10 },
      { id: 2, min_price: 10 },
    ];

    const sources: JoinSource[] = [
      makeSource("a", aItems),
      makeSource("b", bItems),
    ];

    const where = parseExpressionString(
      "a.id == b.id and a.price > b.min_price",
    );

    const joinTree = buildJoinTree(
      sources,
      undefined,
      [
        {
          leftSource: "a",
          leftColumn: "id",
          rightSource: "b",
          rightColumn: "id",
        },
      ],
      [
        {
          leftSource: "a",
          leftColumn: "price",
          operator: ">",
          rightSource: "b",
          rightColumn: "min_price",
        },
      ],
      where,
    );

    const env = testEnvWithSources({ a: aItems, b: bItems });
    const rows = await executeJoinTree(joinTree, env, LuaStackFrame.lostFrame);

    expect(rows.length).toBe(1);
    expect((rows[0].rawGet("a") as any).id).toBe(2);
    expect((rows[0].rawGet("b") as any).id).toBe(2);
  });

  it("semi join respects residual predicate during execution", async () => {
    const aItems = [
      { id: 1, price: 5 },
      { id: 2, price: 20 },
    ];
    const bItems = [
      { id: 1, min_price: 10 },
      { id: 2, min_price: 10 },
    ];

    const sources: JoinSource[] = [
      makeSource("a", aItems),
      {
        ...makeSource("b", bItems),
        hint: {
          type: "JoinHint",
          kind: "hash",
          joinType: "semi",
          ctx: {} as any,
        },
      },
    ];

    const where = parseExpressionString(
      "a.id == b.id and a.price > b.min_price",
    );

    const joinTree = buildJoinTree(
      sources,
      undefined,
      [
        {
          leftSource: "a",
          leftColumn: "id",
          rightSource: "b",
          rightColumn: "id",
        },
      ],
      [
        {
          leftSource: "a",
          leftColumn: "price",
          operator: ">",
          rightSource: "b",
          rightColumn: "min_price",
        },
      ],
      where,
    );

    const env = testEnvWithSources({ a: aItems, b: bItems });
    const rows = await executeJoinTree(joinTree, env, LuaStackFrame.lostFrame);

    expect(rows.length).toBe(1);
    expect((rows[0].rawGet("a") as any).id).toBe(2);
  });

  it("anti join respects residual predicate during execution", async () => {
    const aItems = [
      { id: 1, price: 5 },
      { id: 2, price: 20 },
    ];
    const bItems = [
      { id: 1, min_price: 10 },
      { id: 2, min_price: 10 },
    ];

    const sources: JoinSource[] = [
      makeSource("a", aItems),
      {
        ...makeSource("b", bItems),
        hint: {
          type: "JoinHint",
          kind: "hash",
          joinType: "anti",
          ctx: {} as any,
        },
      },
    ];

    const where = parseExpressionString(
      "a.id == b.id and a.price > b.min_price",
    );

    const joinTree = buildJoinTree(
      sources,
      undefined,
      [
        {
          leftSource: "a",
          leftColumn: "id",
          rightSource: "b",
          rightColumn: "id",
        },
      ],
      [
        {
          leftSource: "a",
          leftColumn: "price",
          operator: ">",
          rightSource: "b",
          rightColumn: "min_price",
        },
      ],
      where,
    );

    const env = testEnvWithSources({ a: aItems, b: bItems });
    const rows = await executeJoinTree(joinTree, env, LuaStackFrame.lostFrame);

    expect(rows.length).toBe(1);
    expect((rows[0].rawGet("a") as any).id).toBe(1);
  });

  it("post-join WHERE wrapper only keeps true residual after stripping consumed join predicates", () => {
    const sources: JoinSource[] = [makeSource("a"), makeSource("b")];

    const where = parseExpressionString(
      "a.id == b.id and a.price > b.min_price and a.keep == 1",
    );

    const joinTree = buildJoinTree(
      sources,
      undefined,
      [
        {
          leftSource: "a",
          leftColumn: "id",
          rightSource: "b",
          rightColumn: "id",
        },
      ],
      [
        {
          leftSource: "a",
          leftColumn: "price",
          operator: ">",
          rightSource: "b",
          rightColumn: "min_price",
        },
      ],
      where,
    );

    const residualWhere = stripUsedJoinPredicates(where, joinTree);
    expect(residualWhere).toBeDefined();
    expect(JSON.stringify(residualWhere)).toContain('"property":"keep"');
    expect(JSON.stringify(residualWhere)).toContain('"value":1');
    expect(JSON.stringify(residualWhere)).not.toContain('"min_price"');
    expect(JSON.stringify(residualWhere)).not.toContain('"operator":">"');

    const explain = wrapPlanWithQueryOps(
      explainJoinTree(joinTree, {
        analyze: false,
        verbose: true,
        summary: false,
        costs: true,
        timing: false,
        hints: false,
      }),
      {
        where: residualWhere,
      },
      new Map(),
    );

    expect(explain.nodeType).toBe("Project");
    expect(explain.children[0].nodeType).toBe("Filter");
    expect(explain.children[0].filterExpr).toBe("a.keep == 1");
    expect(explain.children[0].children[0].joinResidualExprs).toEqual([
      "a.price > b.min_price",
    ]);
  });

  it("executeJoinTree with multiple residual conjuncts keeps only rows matching all", async () => {
    const aItems = [
      { id: 1, price: 15, keep: 1 },
      { id: 2, price: 25, keep: 1 },
      { id: 3, price: 40, keep: 1 },
    ];
    const bItems = [
      { id: 1, min_price: 10, max_price: 20 },
      { id: 2, min_price: 10, max_price: 20 },
      { id: 3, min_price: 10, max_price: 50 },
    ];

    const sources: JoinSource[] = [
      makeSource("a", aItems),
      makeSource("b", bItems),
    ];

    const where = parseExpressionString(
      "a.id == b.id and a.price > b.min_price and a.price <= b.max_price",
    );

    const joinTree = buildJoinTree(
      sources,
      undefined,
      [
        {
          leftSource: "a",
          leftColumn: "id",
          rightSource: "b",
          rightColumn: "id",
        },
      ],
      [
        {
          leftSource: "a",
          leftColumn: "price",
          operator: ">",
          rightSource: "b",
          rightColumn: "min_price",
        },
        {
          leftSource: "a",
          leftColumn: "price",
          operator: "<=",
          rightSource: "b",
          rightColumn: "max_price",
        },
      ],
      where,
    );

    const env = testEnvWithSources({ a: aItems, b: bItems });
    const rows = await executeJoinTree(joinTree, env, LuaStackFrame.lostFrame);

    expect(rows.length).toBe(2);
    expect((rows[0].rawGet("a") as any).id).toBe(1);
    expect((rows[1].rawGet("a") as any).id).toBe(3);
  });

  it("join residual evaluation works when row values are LuaTable instances", async () => {
    const a1 = new LuaTable();
    void a1.rawSet("id", 1);
    void a1.rawSet("price", 5);

    const a2 = new LuaTable();
    void a2.rawSet("id", 2);
    void a2.rawSet("price", 20);

    const b1 = new LuaTable();
    void b1.rawSet("id", 1);
    void b1.rawSet("min_price", 10);

    const b2 = new LuaTable();
    void b2.rawSet("id", 2);
    void b2.rawSet("min_price", 10);

    const aItems = [a1, a2];
    const bItems = [b1, b2];

    const sources: JoinSource[] = [
      makeSource("a", aItems),
      makeSource("b", bItems),
    ];

    const where = parseExpressionString(
      "a.id == b.id and a.price > b.min_price",
    );

    const joinTree = buildJoinTree(
      sources,
      undefined,
      [
        {
          leftSource: "a",
          leftColumn: "id",
          rightSource: "b",
          rightColumn: "id",
        },
      ],
      [
        {
          leftSource: "a",
          leftColumn: "price",
          operator: ">",
          rightSource: "b",
          rightColumn: "min_price",
        },
      ],
      where,
    );

    const env = testEnvWithSources({ a: aItems, b: bItems });
    const rows = await executeJoinTree(joinTree, env, LuaStackFrame.lostFrame);

    expect(rows.length).toBe(1);
    const a = rows[0].rawGet("a") as LuaTable;
    const b = rows[0].rawGet("b") as LuaTable;
    expect(a.rawGet("id")).toBe(2);
    expect(b.rawGet("id")).toBe(2);
  });

  it("residual-only three-source join filters at the lowest covering join", async () => {
    const aItems = [{ x: 1 }, { x: 2 }, { x: 3 }];
    const bItems = [{ y: 10 }, { y: 20 }];
    const cItems = [{ z: 100 }];

    const sources: JoinSource[] = [
      makeSource("a", aItems),
      makeSource("b", bItems),
      makeSource("c", cItems),
    ];

    const where = parseExpressionString("a.x + b.y > 15");

    const joinTree = buildJoinTree(
      sources,
      undefined,
      undefined,
      undefined,
      where,
    );

    const env = testEnvWithSources({ a: aItems, b: bItems, c: cItems });
    const rows = await executeJoinTree(joinTree, env, LuaStackFrame.lostFrame);

    expect(rows.length).toBe(3);
    const totals = rows.map((row) => {
      const a = row.rawGet("a") as any;
      const b = row.rawGet("b") as any;
      const c = row.rawGet("c") as any;
      return a.x + b.y + c.z;
    });
    expect(totals).toEqual([121, 122, 123]);

    const residualWhere = stripUsedJoinPredicates(where, joinTree);
    expect(residualWhere).toBeUndefined();
  });
});

describe("aggregate detection uses configured aggregate registry", () => {
  it("treats config-defined aggregate functions as aggregates in explain planning", () => {
    const plan: ExplainNode = {
      nodeType: "Scan",
      source: "t",
      startupCost: 0,
      estimatedCost: 100,
      estimatedRows: 100,
      estimatedWidth: 5,
      children: [],
    };

    const query = {
      select: parseExpressionString("myagg(t.value)"),
    };

    const config = {
      get(path: string, defaultValue?: any) {
        if (path === "aggregates.myagg") {
          return {
            name: "myagg",
            initialize: () => 0,
            iterate: () => 0,
          };
        }
        return defaultValue;
      },
    };

    const wrapped = wrapPlanWithQueryOps(
      plan,
      query,
      undefined,
      undefined,
      undefined,
      config as any,
    );

    expect(wrapped.nodeType).toBe("Project");
    expect(wrapped.children).toHaveLength(1);

    const aggNode = wrapped.children[0];
    expect(aggNode.nodeType).toBe("GroupAggregate");
    expect(aggNode.implicitGroup).toBe(true);
    expect(aggNode.estimatedRows).toBe(1);
    expect(aggNode.outputColumns).toEqual(["myagg(t.value)"]);
    expect(aggNode.aggregates).toEqual([
      {
        name: "myagg",
        args: "t.value",
      },
    ]);
  });

  it("treats configured aggregate aliases as aggregates in explain planning", () => {
    const plan: ExplainNode = {
      nodeType: "Scan",
      source: "t",
      startupCost: 0,
      estimatedCost: 100,
      estimatedRows: 100,
      estimatedWidth: 5,
      children: [],
    };

    const query = {
      select: parseExpressionString("aliasagg(t.value)"),
    };

    const config = {
      get(path: string, defaultValue?: any) {
        if (path === "aggregates.aliasagg") {
          return {
            alias: "sum",
          };
        }
        return defaultValue;
      },
    };

    const wrapped = wrapPlanWithQueryOps(
      plan,
      query,
      undefined,
      undefined,
      undefined,
      config as any,
    );

    expect(wrapped.nodeType).toBe("Project");
    expect(wrapped.children).toHaveLength(1);

    const aggNode = wrapped.children[0];
    expect(aggNode.nodeType).toBe("GroupAggregate");
    expect(aggNode.implicitGroup).toBe(true);
    expect(aggNode.estimatedRows).toBe(1);
    expect(aggNode.aggregates).toEqual([
      {
        name: "aliasagg",
        args: "t.value",
      },
    ]);
  });

  it("does not classify unknown functions as aggregates", () => {
    const plan: ExplainNode = {
      nodeType: "Scan",
      source: "t",
      startupCost: 0,
      estimatedCost: 100,
      estimatedRows: 100,
      estimatedWidth: 5,
      children: [],
    };

    const query = {
      select: parseExpressionString("unknown_fn(t.value)"),
    };

    const config = {
      get(_path: string, defaultValue?: any) {
        return defaultValue;
      },
    };

    const wrapped = wrapPlanWithQueryOps(
      plan,
      query,
      undefined,
      undefined,
      undefined,
      config as any,
    );

    expect(wrapped.nodeType).toBe("Project");
    expect(wrapped.children).toHaveLength(1);

    const child = wrapped.children[0];
    expect(child.nodeType).not.toBe("GroupAggregate");
  });
});

describe("source with-hints in explain and planning", () => {
  it("leaf explain uses rows, width, and cost hints", () => {
    const source: JoinSource = {
      name: "p",
      expression: parseExpressionString("p"),
      stats: {
        rowCount: 100,
        ndv: new Map([["id", 100]]),
        avgColumnCount: 8,
        statsSource: "computed-exact-small",
      },
      withHints: {
        rows: 7,
        width: 3,
        cost: 11,
      } as any,
    };

    const plan = explainJoinTree(
      { kind: "leaf", source },
      {
        analyze: false,
        verbose: true,
        summary: false,
        costs: true,
        timing: false,
        hints: true,
      },
    );

    expect(plan.nodeType).toBe("Scan");
    expect(plan.estimatedRows).toBe(7);
    expect(plan.estimatedWidth).toBe(3);
    expect(plan.estimatedCost).toBe(11);
    expect(plan.statsSource).toBe("computed-exact-small");
    expect(plan.sourceHints).toEqual(["rows=7", "width=3", "cost=11"]);
  });

  it("leaf explain includes materialized together with source hints", () => {
    const source: JoinSource = {
      name: "p",
      expression: parseExpressionString("p"),
      materialized: true,
      stats: {
        rowCount: 100,
        ndv: new Map([["id", 100]]),
        avgColumnCount: 8,
        statsSource: "computed-exact-small",
      },
      withHints: {
        rows: 5,
        width: 2,
        cost: 13,
      } as any,
    };

    const rendered = formatExplainOutput(
      {
        plan: explainJoinTree(
          { kind: "leaf", source },
          {
            analyze: false,
            verbose: true,
            summary: false,
            costs: true,
            timing: false,
            hints: true,
          },
        ),
        planningTimeMs: 0,
      },
      {
        analyze: false,
        verbose: true,
        summary: false,
        costs: true,
        timing: false,
        hints: true,
      },
    );

    expect(
      rendered.includes("Hints: materialized, rows=5, width=2, cost=13"),
    ).toBe(true);
    expect(rendered.includes("Stats: computed-exact-small")).toBe(true);
  });

  it("does not render Hints line when hints option is disabled", () => {
    const source: JoinSource = {
      name: "p",
      expression: parseExpressionString("p"),
      stats: {
        rowCount: 100,
        ndv: new Map([["id", 100]]),
        avgColumnCount: 8,
        statsSource: "computed-exact-small",
      },
      withHints: {
        rows: 7,
        width: 3,
        cost: 11,
      } as any,
    };

    const rendered = formatExplainOutput(
      {
        plan: explainJoinTree(
          { kind: "leaf", source },
          {
            analyze: false,
            verbose: true,
            summary: false,
            costs: true,
            timing: false,
            hints: false,
          },
        ),
        planningTimeMs: 0,
      },
      {
        analyze: false,
        verbose: true,
        summary: false,
        costs: true,
        timing: false,
        hints: false,
      },
    );

    expect(rendered.includes("Hints:")).toBe(false);
    expect(rendered.includes("Stats: computed-exact-small")).toBe(true);
  });

  it("join tree estimation uses hinted rows on leaf sources", () => {
    const left: JoinSource = {
      ...makeSource("a"),
      withHints: {
        rows: 5,
        width: 2,
      } as any,
    };
    const right: JoinSource = makeSource("b");

    const tree = buildJoinTree([left, right]);

    expect(tree.kind).toBe("join");
    if (tree.kind !== "join") {
      throw new Error("expected join");
    }

    const leftPlan = explainJoinTree(tree, {
      analyze: false,
      verbose: true,
      summary: false,
      costs: true,
      timing: false,
      hints: true,
    }).children[0];

    expect(leftPlan.estimatedRows).toBe(5);
    expect(leftPlan.estimatedWidth).toBe(2);
    expect(leftPlan.statsSource).toBe("computed-exact-small");
  });

  it("hinted source cost affects join estimated cost", () => {
    const sourceA: JoinSource = {
      ...makeSource("a"),
      withHints: {
        rows: 10,
        width: 2,
        cost: 1,
      } as any,
    };
    const sourceB: JoinSource = {
      ...makeSource("b"),
      withHints: {
        rows: 10,
        width: 2,
        cost: 1000,
      } as any,
    };

    const planA = explainJoinTree(
      { kind: "leaf", source: sourceA },
      {
        analyze: false,
        verbose: true,
        summary: false,
        costs: true,
        timing: false,
        hints: true,
      },
    );
    const planB = explainJoinTree(
      { kind: "leaf", source: sourceB },
      {
        analyze: false,
        verbose: true,
        summary: false,
        costs: true,
        timing: false,
        hints: true,
      },
    );

    expect(planA.estimatedCost).toBe(1);
    expect(planB.estimatedCost).toBe(1000);
  });
});

describe("aggregate-local explain nodes", () => {
  const basePlan: ExplainNode = {
    nodeType: "Scan",
    source: "t",
    startupCost: 0,
    estimatedCost: 100,
    estimatedRows: 100,
    estimatedWidth: 5,
    children: [],
  };

  it("adds Filter node for aggregate filter clause", () => {
    const wrapped = wrapPlanWithQueryOps(
      basePlan,
      {
        select: parseExpressionString(
          "{ total = sum(t.v) filter(where t.v > 10) }",
        ),
      },
      undefined,
      undefined,
      undefined,
      undefined,
    );

    expect(wrapped.nodeType).toBe("Project");
    expect(wrapped.children).toHaveLength(1);

    const aggNode = wrapped.children[0];
    expect(aggNode.nodeType).toBe("GroupAggregate");
    expect(aggNode.children).toHaveLength(1);

    const filterNode = aggNode.children[0];
    expect(filterNode.nodeType).toBe("Filter");
    expect(filterNode.filterType).toBe("aggregate");
    expect(filterNode.filterExpr).toContain("sum(t.v) filter(t.v > 10)");
  });

  it("renders aggregate filter in explain output", () => {
    const wrapped = wrapPlanWithQueryOps(
      basePlan,
      {
        select: parseExpressionString(
          "{ total = sum(t.v) filter(where t.v > 10) }",
        ),
      },
      undefined,
      undefined,
      undefined,
      undefined,
    );

    const rendered = formatExplainOutput(
      {
        plan: wrapped,
        planningTimeMs: 0,
      },
      {
        analyze: false,
        verbose: true,
        summary: false,
        costs: true,
        timing: false,
        hints: false,
      },
    );

    expect(rendered.includes("Filter: sum(t.v) filter(t.v > 10)")).toBe(true);
  });

  it("adds Sort (Group) node for aggregate-local order by", () => {
    const wrapped = wrapPlanWithQueryOps(
      basePlan,
      {
        select: parseExpressionString(
          "{ xs = array_agg(t.v order by t.k desc) }",
        ),
      },
      undefined,
      undefined,
      undefined,
      undefined,
    );

    expect(wrapped.nodeType).toBe("Project");
    expect(wrapped.children).toHaveLength(1);

    const aggNode = wrapped.children[0];
    expect(aggNode.nodeType).toBe("GroupAggregate");
    expect(aggNode.children).toHaveLength(1);

    const sortNode = aggNode.children[0];
    expect(sortNode.nodeType).toBe("Sort");
    expect(sortNode.sortType).toBe("group");
    expect(sortNode.sortKeys).toEqual(["t.k desc"]);
  });

  it("renders Sort (Group) in explain output", () => {
    const wrapped = wrapPlanWithQueryOps(
      basePlan,
      {
        select: parseExpressionString(
          "{ xs = array_agg(t.v order by t.k desc) }",
        ),
      },
      undefined,
      undefined,
      undefined,
      undefined,
    );

    const rendered = formatExplainOutput(
      {
        plan: wrapped,
        planningTimeMs: 0,
      },
      {
        analyze: false,
        verbose: true,
        summary: false,
        costs: true,
        timing: false,
        hints: false,
      },
    );

    expect(rendered.includes("Sort (Group)")).toBe(true);
    expect(rendered.includes("Sort Key (Group): t.k desc")).toBe(true);
  });

  it("nests aggregate filter above group sort when both are present", () => {
    const wrapped = wrapPlanWithQueryOps(
      basePlan,
      {
        select: parseExpressionString(
          "{ xs = array_agg(t.v order by t.k asc) filter(where t.keep == true) }",
        ),
      },
      undefined,
      undefined,
      undefined,
      undefined,
    );

    expect(wrapped.nodeType).toBe("Project");
    const aggNode = wrapped.children[0];
    expect(aggNode.nodeType).toBe("GroupAggregate");

    const filterNode = aggNode.children[0];
    expect(filterNode.nodeType).toBe("Filter");
    expect(filterNode.filterType).toBe("aggregate");

    const sortNode = filterNode.children[0];
    expect(sortNode.nodeType).toBe("Sort");
    expect(sortNode.sortType).toBe("group");
    expect(sortNode.sortKeys).toEqual(["t.k"]);
  });

  it("renders aggregate-local sort and filter together", () => {
    const wrapped = wrapPlanWithQueryOps(
      basePlan,
      {
        select: parseExpressionString(
          "{ xs = array_agg(t.v order by t.k asc) filter(where t.keep == true) }",
        ),
      },
      undefined,
      undefined,
      undefined,
      undefined,
    );

    const rendered = formatExplainOutput(
      {
        plan: wrapped,
        planningTimeMs: 0,
      },
      {
        analyze: false,
        verbose: true,
        summary: false,
        costs: true,
        timing: false,
        hints: false,
      },
    );

    expect(rendered.includes("Filter:")).toBe(true);
    expect(rendered.includes("Sort (Group)")).toBe(true);
    expect(rendered.includes("Sort Key (Group): t.k")).toBe(true);
  });
});

describe("aggregate filter analyze stats", () => {
  it("attachAnalyzeQueryOpStats records rows removed by aggregate filter for implicit aggregate", async () => {
    const plan: ExplainNode = wrapPlanWithQueryOps(
      {
        nodeType: "Scan",
        source: "t",
        startupCost: 0,
        estimatedCost: 10,
        estimatedRows: 4,
        estimatedWidth: 2,
        children: [],
      },
      {
        select: parseExpressionString(
          "{ total = sum(t.v) filter(where t.keep == true) }",
        ),
      },
      undefined,
      undefined,
      undefined,
      new Config(),
    );

    attachAnalyzeQueryOpStats(plan, {
      rowsRemovedByAggregateFilter: 3,
    });

    const aggNode = plan.children[0];
    expect(aggNode.nodeType).toBe("GroupAggregate");
    const filterNode = aggNode.children[0];
    expect(filterNode.nodeType).toBe("Filter");
    expect(filterNode.filterType).toBe("aggregate");
    expect(filterNode.rowsRemovedByAggregateFilter).toBe(3);
  });

  it("attachAnalyzeQueryOpStats records rows removed by aggregate filter for grouped aggregate", async () => {
    const plan: ExplainNode = wrapPlanWithQueryOps(
      {
        nodeType: "Scan",
        source: "t",
        startupCost: 0,
        estimatedCost: 10,
        estimatedRows: 5,
        estimatedWidth: 3,
        children: [],
      },
      {
        groupBy: [
          {
            expr: parseExpressionString("t.g"),
          },
        ],
        select: parseExpressionString(
          "{ g = t.g, total = sum(t.v) filter(where t.keep == true) }",
        ),
      },
      undefined,
      undefined,
      undefined,
      new Config(),
    );

    await attachAnalyzeQueryOpStats(plan, {
      rowsRemovedByAggregateFilter: 3,
    });

    const projectNode = plan;
    expect(projectNode.nodeType).toBe("Project");

    const groupNode = projectNode.children[0];
    expect(groupNode.nodeType).toBe("GroupAggregate");

    const filterNode = groupNode.children[0];
    expect(filterNode.nodeType).toBe("Filter");
    expect(filterNode.filterType).toBe("aggregate");
    expect(filterNode.rowsRemovedByAggregateFilter).toBe(3);
  });

  it("executeAndInstrument plus attachAnalyzeQueryOpStats renders aggregate filter removal count", async () => {
    const items = [
      { v: 10, keep: true },
      { v: 20, keep: false },
      { v: 30, keep: false },
      { v: 40, keep: false },
    ];

    const source: JoinSource = {
      ...makeSource("t", items),
      expression: parseExpressionString("t"),
    };

    const tree = buildJoinTree([source]);
    const explainLeaf = explainJoinTree(tree, analyzeOpts());
    const wrapped = wrapPlanWithQueryOps(
      explainLeaf,
      {
        select: parseExpressionString(
          "{ total = sum(t.v) filter(where t.keep == true) }",
        ),
      },
      new Map([
        [
          "t",
          {
            rowCount: items.length,
            ndv: new Map([
              ["v", 4],
              ["keep", 2],
            ]),
            avgColumnCount: 2,
            statsSource: "computed-exact-small",
          },
        ],
      ]),
      undefined,
      undefined,
      new Config(),
    );

    const env = testEnvWithSources({ t: items });

    await executeAndInstrument(
      tree,
      wrapped.children[0].children[0],
      env,
      LuaStackFrame.lostFrame,
      analyzeOpts(),
      undefined,
      undefined,
      0,
    );

    await attachAnalyzeQueryOpStats(wrapped, {
      rowsRemovedByAggregateFilter: 3,
    });

    const rendered = formatExplainOutput(
      {
        plan: wrapped,
        planningTimeMs: 0,
        executionTimeMs: 0,
      },
      analyzeOpts(),
    );

    expect(rendered.includes("Implicit Group Aggregation")).toBe(true);
    expect(rendered.includes("Rows Removed by Aggregate Filter: 3")).toBe(true);
  });
});

describe("normalizePushdownExpression IN / NOT IN rewrites", () => {
  it("preserves `o.x in {1,2,3}` as a QueryIn over a literal table", () => {
    const expr = parseExpressionString("o.x in {1, 2, 3}");
    const normalized = normalizePushdownExpression(expr);
    expect(normalized.type).toBe("QueryIn");
    const rendered = exprToString(normalized);
    expect(rendered).toContain("o.x in");
    expect(rendered).toContain("1");
    expect(rendered).toContain("2");
    expect(rendered).toContain("3");
  });

  it("rewrites `not (o.x in {1, 2, 3})` into `o.x ~= 1 and o.x ~= 2 and o.x ~= 3`", () => {
    const expr = parseExpressionString("not (o.x in {1, 2, 3})");
    const normalized = normalizePushdownExpression(expr);
    expect(normalized.type).toBe("Binary");
    const rendered = exprToString(normalized);
    expect(rendered).toContain("o.x ~= 1");
    expect(rendered).toContain("o.x ~= 2");
    expect(rendered).toContain("o.x ~= 3");
    expect(rendered).not.toContain(" in ");
    expect(rendered).not.toContain("not ");
  });

  it("leaves `not (o.x in other)` unchanged when RHS is not a literal table", () => {
    const expr = parseExpressionString("not (o.x in other_table)");
    const normalized = normalizePushdownExpression(expr);
    const rendered = exprToString(normalized);
    expect(rendered).toContain("not ");
    expect(rendered).toContain(" in ");
  });
});

describe("extractSingleSourceFilters with IN / NOT IN", () => {
  it("pushes down `o.x in {literal, ...}` as a single-source filter", () => {
    const expr = parseExpressionString("o.x in {1, 2, 3}");
    const { pushed, residual } = extractSingleSourceFilters(
      expr,
      new Set(["o"]),
    );
    expect(residual).toBeUndefined();
    expect(pushed).toHaveLength(1);
    expect(pushed[0].sourceName).toBe("o");
  });

  it("pushes `not (o.x in {literals})` as a single-source filter (rewritten to ANDed ~=)", () => {
    const expr = parseExpressionString("not (o.x in {1, 2, 3})");
    const { pushed, residual } = extractSingleSourceFilters(
      expr,
      new Set(["o"]),
    );
    expect(residual).toBeUndefined();
    expect(pushed).toHaveLength(1);
    expect(pushed[0].sourceName).toBe("o");
    const rendered = exprToString(pushed[0].expression);
    expect(rendered).toContain("o.x ~= 1");
    expect(rendered).toContain("o.x ~= 3");
  });

  it("keeps a mixed-source `in` out of single-source pushdown", () => {
    const expr = parseExpressionString("o.x in {1, b.y, 3}");
    const { pushed, residual } = extractSingleSourceFilters(
      expr,
      new Set(["o", "b"]),
    );
    expect(pushed).toHaveLength(0);
    expect(residual).toBeDefined();
  });
});

describe("per-node Output: walker and verbose gating", () => {
  // Build a tiny synthetic two-source plan we control fully.  A Hash Join
  // sits over two scans; on top we put `wrapPlanWithQueryOps` with a
  // `select t.id, t.name, p.title` so the Project is multi-source.
  function buildTwoScanPlan(): ExplainNode {
    return {
      nodeType: "HashJoin",
      startupCost: 0,
      estimatedCost: 200,
      estimatedRows: 100,
      estimatedWidth: 10,
      children: [
        {
          nodeType: "Scan",
          source: "t",
          startupCost: 0,
          estimatedCost: 10,
          estimatedRows: 10,
          estimatedWidth: 5,
          children: [],
        },
        {
          nodeType: "Scan",
          source: "p",
          startupCost: 0,
          estimatedCost: 10,
          estimatedRows: 10,
          estimatedWidth: 5,
          children: [],
        },
      ],
    };
  }

  function statsFor(
    cols: string[],
    rowCount = 10,
  ): { ndv: Map<string, number>; rowCount: number } {
    const ndv = new Map<string, number>();
    for (const c of cols) ndv.set(c, rowCount);
    return { ndv, rowCount };
  }

  function render(plan: ExplainNode, verbose: boolean): string {
    return formatExplainOutput({ plan, planningTimeMs: 0 }, {
      analyze: false,
      verbose,
      summary: false,
      costs: false,
      timing: false,
      hints: false,
    } as const);
  }

  function outputLines(rendered: string): string[] {
    return rendered
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("Output:"));
  }

  it("populates per-node Output: with dotted source-qualified columns under multi-source", () => {
    const sourceStats = new Map<string, any>([
      ["t", statsFor(["id", "name"])],
      ["p", statsFor(["id", "title"])],
    ]);
    const wrapped = wrapPlanWithQueryOps(
      buildTwoScanPlan(),
      {
        select: parseExpressionString(
          "{ id = t.id, name = t.name, title = p.title }",
        ),
      },
      sourceStats,
    );

    const outputs = outputLines(render(wrapped, true));

    // Project at the root: select-list expressions verbatim, aliases dropped.
    expect(outputs[0]).toBe("Output: t.id, t.name, p.title");
    // Hash Join unions children's outputs (deduped, first-seen order).
    expect(outputs).toContain("Output: t.id, t.name, p.id, p.title");
    // Each scan emits its own source-qualified columns.
    expect(outputs).toContain("Output: t.id, t.name");
    expect(outputs).toContain("Output: p.id, p.title");
  });

  it("drops Output: entirely under bare (non-verbose) explain", () => {
    const sourceStats = new Map<string, any>([
      ["t", statsFor(["id", "name"])],
      ["p", statsFor(["id", "title"])],
    ]);
    const wrapped = wrapPlanWithQueryOps(
      buildTwoScanPlan(),
      {
        select: parseExpressionString("{ id = t.id }"),
      },
      sourceStats,
    );

    expect(outputLines(render(wrapped, false))).toEqual([]);
  });

  it("emits unqualified scan columns for single-source plans", () => {
    const leaf: ExplainNode = {
      nodeType: "Scan",
      source: "t",
      startupCost: 0,
      estimatedCost: 10,
      estimatedRows: 10,
      estimatedWidth: 5,
      children: [],
    };
    const sourceStats = new Map<string, any>([["t", statsFor(["id", "name"])]]);
    const wrapped = wrapPlanWithQueryOps(
      leaf,
      {
        select: parseExpressionString("{ id = t.id }"),
      },
      sourceStats,
    );

    const outputs = outputLines(render(wrapped, true));
    // Project: alias dropped, expression preserved.
    expect(outputs[0]).toBe("Output: t.id");
    // Scan: unqualified bare columns (Postgres `useprefix=false`).
    expect(outputs).toContain("Output: id, name");
  });

  it("falls back to wildcard placeholder when scan stats are missing", () => {
    const wrapped = wrapPlanWithQueryOps(
      buildTwoScanPlan(),
      { select: parseExpressionString("{ id = t.id }") },
      // No sourceStats -- walker has nothing to qualify against.
    );
    const outputs = outputLines(render(wrapped, true));
    // With unknown source count we render unqualified `*` for both scans
    // and the join (deduped to a single entry).
    expect(outputs).toContain("Output: *");
  });

  it("expands wildcards in Project Output: against the child column list", () => {
    const sourceStats = new Map<string, any>([
      ["t", statsFor(["id", "name"])],
      ["p", statsFor(["id", "title"])],
    ]);
    const wrapped = wrapPlanWithQueryOps(
      buildTwoScanPlan(),
      {
        select: {
          type: "TableConstructor",
          fields: [
            { type: "StarSourceField", source: "t", ctx: {} as any },
            { type: "StarColumnField", column: "title", ctx: {} as any },
          ],
          ctx: {} as any,
        },
      },
      sourceStats,
    );
    const outputs = outputLines(render(wrapped, true));
    expect(outputs[0]).toBe("Output: t.id, t.name, p.title");
  });

  it("falls back to symbolic wildcards when child column list is unknown", () => {
    const wrapped = wrapPlanWithQueryOps(buildTwoScanPlan(), {
      select: {
        type: "TableConstructor",
        fields: [
          { type: "StarSourceField", source: "t", ctx: {} as any },
          { type: "StarColumnField", column: "title", ctx: {} as any },
        ],
        ctx: {} as any,
      },
    });
    const outputs = outputLines(render(wrapped, true));
    expect(outputs[0]).toBe("Output: t.*, *.title");
  });
});

describe("computeResultColumns", () => {
  it("returns an empty list for empty / nullish input", () => {
    expect(computeResultColumns([])).toEqual([]);
    expect(computeResultColumns(null)).toEqual([]);
    expect(computeResultColumns(undefined)).toEqual([]);
  });

  it("unions string keys across rows in first-seen order", () => {
    const rows = [{ a: 1, b: 2 }, { b: 3, c: 4 }, { a: 5 }];
    expect(computeResultColumns(rows)).toEqual(["a", "b", "c"]);
  });

  it("ignores numeric (array-style) keys", () => {
    const rows = [{ 0: "ignore", x: 1 }];
    expect(computeResultColumns(rows)).toEqual(["x"]);
  });

  it("quotes keys that aren't bare Lua identifiers", () => {
    const rows = [{ "zup name": 1, normal: 2, 'with"quote': 3 }];
    expect(computeResultColumns(rows)).toEqual([
      `"zup name"`,
      "normal",
      `"with\\"quote"`,
    ]);
  });

  it("reads keys() off a LuaTable-shaped row", () => {
    const fakeLuaRow = {
      keys() {
        return ["t_id", "t_name", "p_title", 1];
      },
    };
    expect(computeResultColumns([fakeLuaRow])).toEqual([
      "t_id",
      "t_name",
      "p_title",
    ]);
  });
});

describe("CollectionStats.virtualColumns surfaces in EXPLAIN VERBOSE", () => {
  function statsWithVirtualColumns(
    rowCount: number,
    virtualColumns: { column: string; rowCount: number; ndv: number }[],
  ): import("./join_planner.ts").JoinSource["stats"] {
    return {
      rowCount,
      ndv: new Map<string, number>([["name", rowCount]]),
      avgColumnCount: 11,
      statsSource: "persisted-complete",
      virtualColumns: virtualColumns.map((v) => ({
        column: v.column,
        overlay: "page",
        rowCount: v.rowCount,
        ndv: v.ndv,
      })),
      executionCapabilities: {
        engines: [
          {
            id: "object-index-bitmap-extended",
            name: "Object index bitmap extended scan",
            kind: "index",
            capabilities: [
              "scan-index",
              "scan-bitmap",
              "stage-where",
              "pred-eq",
              "pred-neq",
              "pred-in",
              "expr-literal",
              "expr-column-qualified",
              "bool-and",
              "bool-not",
              "stats-row-count",
              "stats-ndv",
            ],
            baseCostWeight: 0.6,
            priority: 20,
          },
        ],
      },
    };
  }

  it(
    "Function Seq Scan node carries virtualColumns when the predicate " +
      "engages the augmenter (column referenced)",
    () => {
      const source: JoinSource = {
        name: "p",
        expression: parseExpressionString("index.tag('page')"),
        stats: statsWithVirtualColumns(241, [
          { column: "lastAccessed", rowCount: 5, ndv: 5 },
        ]),
      };

      const pushed = new Map<string, string>([["p", "p.lastAccessed ~= nil"]]);
      const plan = explainJoinTree(
        { kind: "leaf", source },
        {
          analyze: false,
          verbose: true,
          summary: false,
          costs: true,
          timing: false,
          hints: false,
        },
        pushed,
      );

      expect(plan.virtualColumns).toBeDefined();
      expect(plan.virtualColumns!.map((v) => v.column)).toEqual([
        "lastAccessed",
      ]);
    },
  );

  it(
    "Function Seq Scan node hides virtualColumns when the predicate " +
      "does NOT reference the augmenter-owned column",
    () => {
      const source: JoinSource = {
        name: "p",
        expression: parseExpressionString("index.tag('page')"),
        stats: statsWithVirtualColumns(241, [
          { column: "lastAccessed", rowCount: 5, ndv: 5 },
        ]),
      };

      const pushed = new Map<string, string>([["p", "p.name == 'Home'"]]);
      const plan = explainJoinTree(
        { kind: "leaf", source },
        {
          analyze: false,
          verbose: true,
          summary: false,
          costs: true,
          timing: false,
          hints: false,
        },
        pushed,
      );

      expect(plan.virtualColumns).toBeUndefined();
    },
  );

  it("renders an `Owns:` line on the augmenter engine block for each engaged virtual column", () => {
    const source: JoinSource = {
      name: "p",
      expression: parseExpressionString("index.tag('page')"),
      stats: statsWithBitmapAndAugmenter(241, [
        { column: "lastAccessed", rowCount: 5, ndv: 5 },
      ]),
    };

    const pushed = new Map<string, string>([["p", "p.lastAccessed ~= nil"]]);
    const plan = explainJoinTree(
      { kind: "leaf", source },
      {
        analyze: false,
        verbose: true,
        summary: false,
        costs: true,
        timing: false,
        hints: false,
      },
      pushed,
    );

    const rendered = formatExplainOutput(
      { plan, planningTimeMs: 0 },
      {
        analyze: false,
        verbose: true,
        summary: false,
        costs: true,
        timing: false,
        hints: false,
      },
    );

    expect(rendered).toContain("Engine: augmenter-overlay-page");
    expect(rendered).toContain("Owns: lastAccessed  (rows=5 ndv=5)");
    expect(rendered).not.toContain("Augmenter Overlay: page");
  });

  it(
    "preserves legacy behaviour: a single-source predicate touching " +
      "a virtual column is STILL pushed down to the source (no demotion)",
    () => {
      const where = parseExpressionString(
        "p.lastAccessed and p.name ~= 'Home'",
      );
      const { pushed, residual } = extractSingleSourceFilters(
        where,
        new Set(["p"]),
      );
      expect(pushed).toHaveLength(1);
      expect(residual).toBeUndefined();
      const rendered = exprToDisplayString(pushed[0].expression);
      expect(rendered).toContain("p.lastAccessed");
      expect(rendered).toContain("p.name ~= 'Home'");
    },
  );

  function statsWithBitmapAndAugmenter(
    rowCount: number,
    virtualColumns: { column: string; rowCount: number; ndv: number }[],
  ): import("./join_planner.ts").JoinSource["stats"] {
    return {
      rowCount,
      ndv: new Map<string, number>([["name", rowCount]]),
      avgColumnCount: 11,
      statsSource: "persisted-complete",
      virtualColumns: virtualColumns.map((v) => ({
        column: v.column,
        overlay: "page",
        rowCount: v.rowCount,
        ndv: v.ndv,
      })),
      executionCapabilities: {
        engines: [
          {
            id: "object-index-bitmap-extended",
            name: "Object index bitmap extended scan",
            kind: "index",
            capabilities: [
              "scan-index",
              "scan-bitmap",
              "stage-where",
              "pred-eq",
              "pred-neq",
              "pred-in",
              "expr-literal",
              "expr-column-qualified",
              "bool-and",
              "bool-not",
              "stats-row-count",
              "stats-ndv",
            ],
            baseCostWeight: 0.6,
            priority: 20,
          },
          {
            id: "augmenter-overlay-page",
            name: "Augmenter overlay (page)",
            kind: "overlay",
            capabilities: [
              "scan-augmenter",
              "stage-where-augmenter",
              "pred-eq",
              "pred-neq",
              "pred-lt",
              "pred-lte",
              "pred-gt",
              "pred-gte",
              "pred-is-nil",
              "pred-is-not-nil",
              "expr-literal",
              "expr-column-qualified",
              "bool-and",
              "stats-row-count",
              "stats-ndv",
            ],
            baseCostWeight: 0.4,
            priority: 25,
            metadata: { overlay: "page" },
          },
        ],
      },
    };
  }

  it(
    "renders composite Pushdown Capabilities + per-engine capability lines " +
      "when the predicate engages the augmenter",
    () => {
      const source: JoinSource = {
        name: "p",
        expression: parseExpressionString("index.tag('page')"),
        stats: statsWithBitmapAndAugmenter(241, [
          { column: "lastAccessed", rowCount: 5, ndv: 5 },
        ]),
      };

      const pushed = new Map<string, string>([
        ["p", "p.lastAccessed ~= nil and p.name ~= 'Home'"],
      ]);
      const plan = explainJoinTree(
        { kind: "leaf", source },
        {
          analyze: false,
          verbose: true,
          summary: false,
          costs: true,
          timing: false,
          hints: false,
        },
        pushed,
      );

      const rendered = formatExplainOutput(
        { plan, planningTimeMs: 0 },
        {
          analyze: false,
          verbose: true,
          summary: false,
          costs: true,
          timing: false,
          hints: false,
        },
      );

      expect(rendered).toContain(
        "Pushdown Capabilities: bitmap-extended, augmenter-overlay",
      );
      expect(rendered).toContain(
        "Engines: object-index-bitmap-extended, augmenter-overlay-page",
      );
      const lines = rendered.split("\n");
      const bitmapHeaderIdx = lines.findIndex((l) =>
        l.includes("Engine: object-index-bitmap-extended"),
      );
      expect(bitmapHeaderIdx).toBeGreaterThanOrEqual(0);
      expect(lines[bitmapHeaderIdx]).toContain("kind=index");
      expect(lines[bitmapHeaderIdx]).toContain("cost=0.6");
      expect(lines[bitmapHeaderIdx]).toContain("priority=20");
      const bitmapCapsLine = lines[bitmapHeaderIdx + 1];
      expect(bitmapCapsLine).toContain("Capabilities:");
      expect(bitmapCapsLine).toContain("scan-bitmap");
      // Augmenter caps must NOT appear under the bitmap engine's block.
      expect(bitmapCapsLine).not.toContain("aug-eq");
      expect(bitmapCapsLine).not.toContain("scan-augmenter");

      const augHeaderIdx = lines.findIndex((l) =>
        l.includes("Engine: augmenter-overlay-page"),
      );
      expect(augHeaderIdx).toBeGreaterThanOrEqual(0);
      expect(lines[augHeaderIdx]).toContain("kind=overlay");
      expect(lines[augHeaderIdx]).toContain("cost=0.4");
      expect(lines[augHeaderIdx]).toContain("priority=25");
      const augCapsLine = lines[augHeaderIdx + 1];
      expect(augCapsLine).toContain("Capabilities:");
      expect(augCapsLine).toContain("pred-eq");
      expect(augCapsLine).toContain("pred-is-nil");
      expect(augCapsLine).toContain("scan-augmenter");
      expect(augCapsLine).not.toContain("aug-eq");
      expect(augCapsLine).not.toContain("aug-is-nil");

      expect(rendered).toContain("Owns: lastAccessed  (rows=5 ndv=5)");

      expect(rendered).not.toContain("Planner Capabilities:");
      expect(rendered).not.toContain("Augmenter Overlay Capabilities");
      expect(rendered).not.toContain("Augmenter Overlay: page");
    },
  );

  it(
    "augmenter is dormant when no predicate references its columns: " +
      "Pushdown Capabilities lists only bitmap-extended, no augmenter " +
      "engine in `Engines:`, no `Augmenter Overlay` lines",
    () => {
      const source: JoinSource = {
        name: "p",
        expression: parseExpressionString("index.tag('page')"),
        stats: statsWithBitmapAndAugmenter(241, [
          { column: "lastAccessed", rowCount: 5, ndv: 5 },
        ]),
      };

      const pushed = new Map<string, string>([["p", "p.name == 'Home'"]]);
      const plan = explainJoinTree(
        { kind: "leaf", source },
        {
          analyze: false,
          verbose: true,
          summary: false,
          costs: true,
          timing: false,
          hints: false,
        },
        pushed,
      );

      const rendered = formatExplainOutput(
        { plan, planningTimeMs: 0 },
        {
          analyze: false,
          verbose: true,
          summary: false,
          costs: true,
          timing: false,
          hints: false,
        },
      );

      expect(rendered).toContain("Pushdown Capabilities: bitmap-extended");
      expect(rendered).not.toContain("augmenter-overlay");
      expect(rendered).not.toContain("Augmenter Overlay Capabilities");
      expect(rendered).not.toContain("Augmenter Overlay: page");
      expect(rendered).not.toContain("augmenter-overlay-page");
    },
  );

  it(
    "without augmenter engine in stats: Pushdown Capabilities stays " +
      "bitmap-extended and no Augmenter Overlay output is rendered",
    () => {
      const source: JoinSource = {
        name: "p",
        expression: parseExpressionString("index.tag('page')"),
        stats: statsWithVirtualColumns(241, []),
      };

      const plan = explainJoinTree(
        { kind: "leaf", source },
        {
          analyze: false,
          verbose: true,
          summary: false,
          costs: true,
          timing: false,
          hints: false,
        },
      );

      const rendered = formatExplainOutput(
        { plan, planningTimeMs: 0 },
        {
          analyze: false,
          verbose: true,
          summary: false,
          costs: true,
          timing: false,
          hints: false,
        },
      );

      expect(rendered).toContain("Pushdown Capabilities: bitmap-extended");
      expect(rendered).not.toContain("augmenter-overlay");
      expect(rendered).not.toContain("Augmenter Overlay Capabilities");
    },
  );

  it("per-engine block format: single bitmap engine, no augmenter, no `Owns:` line", () => {
    const source: JoinSource = {
      name: "p",
      expression: parseExpressionString("index.tag('page')"),
      stats: statsWithVirtualColumns(241, []),
    };

    const pushed = new Map<string, string>([["p", "p.tag == 'page'"]]);
    const plan = explainJoinTree(
      { kind: "leaf", source },
      {
        analyze: false,
        verbose: true,
        summary: false,
        costs: true,
        timing: false,
        hints: false,
      },
      pushed,
    );

    const rendered = formatExplainOutput(
      { plan, planningTimeMs: 0 },
      {
        analyze: false,
        verbose: true,
        summary: false,
        costs: true,
        timing: false,
        hints: false,
      },
    );

    const lines = rendered.split("\n");
    const headerIdx = lines.findIndex((l) =>
      l.includes("Engine: object-index-bitmap-extended"),
    );
    expect(headerIdx).toBeGreaterThanOrEqual(0);
    expect(lines[headerIdx]).toContain("kind=index");
    expect(lines[headerIdx]).toContain("cost=0.6");
    expect(lines[headerIdx]).toContain("priority=20");
    expect(lines[headerIdx + 1]).toContain("Capabilities:");
    // No second engine, no `Owns:` line.
    expect(rendered.match(/Engine: /g)?.length).toBe(1);
    expect(rendered).not.toContain("Owns:");
  });

  it("per-engine block format: hidden in non-verbose EXPLAIN (only `Engines:` summary)", () => {
    const source: JoinSource = {
      name: "p",
      expression: parseExpressionString("index.tag('page')"),
      stats: statsWithBitmapAndAugmenter(241, [
        { column: "lastAccessed", rowCount: 5, ndv: 5 },
      ]),
    };

    const pushed = new Map<string, string>([["p", "p.lastAccessed ~= nil"]]);
    const plan = explainJoinTree(
      { kind: "leaf", source },
      {
        analyze: false,
        verbose: false,
        summary: false,
        costs: true,
        timing: false,
        hints: false,
      },
      pushed,
    );

    const rendered = formatExplainOutput(
      { plan, planningTimeMs: 0 },
      {
        analyze: false,
        verbose: false,
        summary: false,
        costs: true,
        timing: false,
        hints: false,
      },
    );

    // Non-verbose: per-engine blocks suppressed; only the high-level
    // `Engines:` summary survives.
    expect(rendered).not.toContain("Engine: object-index-bitmap-extended");
    expect(rendered).not.toContain("Engine: augmenter-overlay-page");
    expect(rendered).not.toContain("Capabilities:");
    expect(rendered).not.toContain("Owns:");
  });

  it(
    "EXPLAIN ANALYZE VERBOSE: per-engine `Runtime:` line surfaces " +
      "captured runtime stats per engine",
    () => {
      const stats = statsWithBitmapAndAugmenter(241, [
        { column: "lastAccessed", rowCount: 5, ndv: 5 },
      ]);
      // Stamp runtime stats on the bitmap engine entry as eval.ts
      // would after the dispatcher runs.
      const engines = stats!.executionCapabilities!.engines;
      const bitmapIdx = engines.findIndex(
        (e) => e.id === "object-index-bitmap-extended",
      );
      engines[bitmapIdx] = {
        ...engines[bitmapIdx],
        runtimeStats: {
          "rows-examined": 1500,
          "rows-returned": 42,
          "time-ms": 2.5,
        },
        executeMs: 3.125,
      };

      const source: JoinSource = {
        name: "p",
        expression: parseExpressionString("index.tag('page')"),
        stats,
      };
      const pushed = new Map<string, string>([["p", "p.lastAccessed ~= nil"]]);
      const plan = explainJoinTree(
        { kind: "leaf", source },
        {
          analyze: true,
          verbose: true,
          summary: false,
          costs: true,
          timing: false,
          hints: false,
        },
        pushed,
      );

      const rendered = formatExplainOutput(
        { plan, planningTimeMs: 0 },
        {
          analyze: true,
          verbose: true,
          summary: false,
          costs: true,
          timing: false,
          hints: false,
        },
      );

      const lines = rendered.split("\n");
      const bitmapHeaderIdx = lines.findIndex((l) =>
        l.includes("Engine: object-index-bitmap-extended"),
      );
      expect(bitmapHeaderIdx).toBeGreaterThanOrEqual(0);
      const blockSlice = lines.slice(bitmapHeaderIdx, bitmapHeaderIdx + 6);
      const runtimeLine = blockSlice.find((l) => l.includes("Runtime:"));
      expect(runtimeLine).toBeDefined();
      expect(runtimeLine).toContain("rows-examined=1500");
      expect(runtimeLine).toContain("rows-returned=42");
      expect(runtimeLine).toContain("op-time=2.500");
      expect(runtimeLine).toContain("exec-time=3.125");
      expect(runtimeLine).not.toContain("time-ms=");
      expect(runtimeLine).not.toContain("execute-ms=");

      const augHeaderIdx = lines.findIndex((l) =>
        l.includes("Engine: augmenter-overlay-page"),
      );
      expect(augHeaderIdx).toBeGreaterThanOrEqual(0);
      const augBlock = lines.slice(augHeaderIdx, augHeaderIdx + 4);
      expect(augBlock.find((l) => l.includes("Runtime:"))).toBeUndefined();
    },
  );

  it("EXPLAIN VERBOSE without ANALYZE: `Runtime:` line is suppressed", () => {
    const stats = statsWithBitmapAndAugmenter(241, []);
    const engines = stats!.executionCapabilities!.engines;
    engines[0] = {
      ...engines[0],
      runtimeStats: { "rows-examined": 99 },
      executeMs: 1.0,
    };
    const source: JoinSource = {
      name: "p",
      expression: parseExpressionString("index.tag('page')"),
      stats,
    };
    const pushed = new Map<string, string>([["p", "p.tag == 'page'"]]);
    const plan = explainJoinTree(
      { kind: "leaf", source },
      {
        analyze: false,
        verbose: true,
        summary: false,
        costs: true,
        timing: false,
        hints: false,
      },
      pushed,
    );
    const rendered = formatExplainOutput(
      { plan, planningTimeMs: 0 },
      {
        analyze: false,
        verbose: true,
        summary: false,
        costs: true,
        timing: false,
        hints: false,
      },
    );
    expect(rendered).not.toContain("Runtime:");
  });

  it(
    "leftover-only normalization: when EVERY conjunct is structurally " +
      "non-pushable (e.g. unknown_fn(p.x)), explain still shows the leftover",
    () => {
      const where = parseExpressionString("unknown_fn(p.x)");
      const info = buildNormalizationInfoBySource(where, new Set(["p"]));
      const pInfo = info.get("p");
      expect(pInfo).toBeDefined();
      expect(pInfo!.state).toBe("partial");
      expect(pInfo!.pushdownExpr).toBe("none");
      expect(pInfo!.leftoverExpr).toBe("unknown_fn(p.x)");
    },
  );
});

describe("pruneAlwaysTrueConjuncts", () => {
  it("returns expression unchanged when no tautologies are present", () => {
    const expr = parseExpressionString("p.x == 1 and p.y > 2");
    const { expr: out, pruned } = pruneAlwaysTrueConjuncts(expr);
    expect(pruned).toEqual([]);
    expect(out).toBe(expr);
  });

  it("returns undefined for an undefined input", () => {
    const { expr, pruned } = pruneAlwaysTrueConjuncts(undefined);
    expect(expr).toBeUndefined();
    expect(pruned).toEqual([]);
  });

  it("prunes a literal `true` conjunct out of a top-level AND", () => {
    const expr = parseExpressionString("p.x == 1 and true and p.y > 2");
    const { expr: out, pruned } = pruneAlwaysTrueConjuncts(expr);
    expect(pruned).toHaveLength(1);
    expect(formatPrunedConjuncts(pruned)).toEqual(["true"]);
    expect(out).toBeDefined();
    expect(exprToDisplayString(out!)).toBe("(p.x == 1) and (p.y > 2)");
  });

  it("prunes parenthesised `(true)` conjuncts", () => {
    const expr = parseExpressionString("p.x == 1 and (true)");
    const { expr: out, pruned } = pruneAlwaysTrueConjuncts(expr);
    expect(pruned).toHaveLength(1);
    expect(out).toBeDefined();
    expect(exprToDisplayString(out!)).toBe("p.x == 1");
  });

  it("prunes `not false` and `not nil` conjuncts", () => {
    const expr = parseExpressionString(
      "p.x == 1 and not false and p.y > 2 and not nil",
    );
    const { expr: out, pruned } = pruneAlwaysTrueConjuncts(expr);
    expect(pruned).toHaveLength(2);
    expect(formatPrunedConjuncts(pruned).sort()).toEqual(
      ["not false", "not nil"].sort(),
    );
    expect(out).toBeDefined();
    expect(exprToDisplayString(out!)).toBe("(p.x == 1) and (p.y > 2)");
  });

  it("returns undefined expr when EVERY conjunct is a tautology", () => {
    const expr = parseExpressionString("true and not false and (true)");
    const { expr: out, pruned } = pruneAlwaysTrueConjuncts(expr);
    // All three literal forms recognised; nothing left to filter on.
    expect(pruned).toHaveLength(3);
    expect(out).toBeUndefined();
  });

  it("does NOT prune `false` or `nil` (would change result set)", () => {
    const expr = parseExpressionString("p.x == 1 and false");
    const { expr: out, pruned } = pruneAlwaysTrueConjuncts(expr);
    expect(pruned).toEqual([]);
    expect(out).toBe(expr);
  });

  it("does NOT fold `(x or true)` (disjunctions left alone)", () => {
    const expr = parseExpressionString("p.x == 1 and (p.y == 2 or true)");
    const { expr: out, pruned } = pruneAlwaysTrueConjuncts(expr);
    expect(pruned).toEqual([]);
    expect(out).toBe(expr);
  });

  it("handles a single literal-true WHERE clause", () => {
    const expr = parseExpressionString("true");
    const { expr: out, pruned } = pruneAlwaysTrueConjuncts(expr);
    expect(pruned).toHaveLength(1);
    expect(out).toBeUndefined();
  });
});

describe("formatExplainOutput renders Pruned Predicates line", () => {
  function makeMinimalPlanResult(prunedPredicates?: string[]): {
    plan: ExplainNode;
    planningTimeMs: number;
    prunedPredicates?: string[];
  } {
    const plan: ExplainNode = {
      nodeType: "Scan",
      source: "p",
      startupCost: 0,
      estimatedCost: 10,
      estimatedRows: 100,
      estimatedWidth: 5,
      children: [],
    };
    return { plan, planningTimeMs: 0, prunedPredicates };
  }

  function verboseOpts(verbose: boolean) {
    return {
      analyze: false,
      verbose,
      summary: true,
      costs: true,
      timing: false,
      hints: false,
    } as const;
  }

  it("renders a Pruned Predicates line in verbose mode", () => {
    const rendered = formatExplainOutput(
      makeMinimalPlanResult(["true", "not false"]),
      verboseOpts(true),
    );
    expect(rendered).toContain(
      "Pruned Predicates: true, not false (always-true)",
    );
  });

  it("omits the Pruned Predicates line when no conjuncts were pruned", () => {
    const rendered = formatExplainOutput(
      makeMinimalPlanResult(undefined),
      verboseOpts(true),
    );
    expect(rendered.includes("Pruned Predicates")).toBe(false);
  });

  it("omits the Pruned Predicates line in non-verbose mode", () => {
    const rendered = formatExplainOutput(
      makeMinimalPlanResult(["true"]),
      verboseOpts(false),
    );
    expect(rendered.includes("Pruned Predicates")).toBe(false);
  });

  it("omits the Pruned Predicates line when the array is empty", () => {
    const rendered = formatExplainOutput(
      makeMinimalPlanResult([]),
      verboseOpts(true),
    );
    expect(rendered.includes("Pruned Predicates")).toBe(false);
  });
});
