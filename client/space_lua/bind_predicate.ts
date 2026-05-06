/**
 * Predicate binding: convert a `LuaExpression` WHERE-clause sub-tree into
 * the `BoundPredicate` shape that engines consume via `QueryEngine.plan()`.
 *
 *   - Recognise `and` / `or` / `not` composites and build matching
 *     `BoundCompositePredicate` nodes.
 *
 *   - Recognise leaf comparisons (`==`, `~=`, `<`, `<=`, `>`, `>=`) and
 *     `QueryIn` against a literal table; normalise so the column always
 *     sits on the LEFT of the `op` and emit a `BoundLeafPredicate`.
 *
 *   - Cross-column comparisons (`p.x < p.y`) are emitted as leaves with
 *     a `column`-kind value on the right; engines that do not advertise
 *     `column-qualified` value support skip those at plan time.
 *
 *   - Anything else (function calls, arithmetic, bare truthiness checks,
 *     multi-relation references) becomes `BoundOpaquePredicate`. Only
 *     the compute fallback claims those.
 *
 *   - No simplification, no constant folding, no de-Morgan here.
 *
 *   The legacy `extractAugmenterPredicates` recognises four spellings of
 *   the same underlying check; we collapse them all into `is-nil` /
 *   `is-not-nil` leaves at bind time so engines have one shape to match:
 *
 *     `p.col`        -> leaf { op: "is-not-nil", column: "col" }
 *     `not p.col`    -> leaf { op: "is-nil",     column: "col" }
 *     `p.col == nil` -> leaf { op: "is-nil",     column: "col" }
 *     `nil == p.col` -> leaf { op: "is-nil",     column: "col" }
 *     `p.col ~= nil` -> leaf { op: "is-not-nil", column: "col" }
 *     `nil ~= p.col` -> leaf { op: "is-not-nil", column: "col" }
 *
 *   Engines that do NOT advertise `is-nil` / `is-not-nil` in their column
 *   spec simply decline these leaves in `plan()` and the planner falls
 *   back to compute. No engine ever has to recognise these spellings itself.
 */

import type {
  LuaBinaryExpression,
  LuaExpression,
  LuaParenthesizedExpression,
  LuaQueryInExpression,
  LuaUnaryExpression,
} from "./ast.ts";
import type {
  BoundCompositePredicate,
  BoundLeafPredicate,
  BoundOpaquePredicate,
  BoundPredicate,
  BoundValue,
  EnginePredicateKind,
} from "./engine_contract.ts";

const COMPARISON_OP_TO_KIND: Record<string, EnginePredicateKind> = {
  "==": "eq",
  "~=": "neq",
  "!=": "neq",
  "<": "lt",
  "<=": "lte",
  ">": "gt",
  ">=": "gte",
};

// Inverse-flip table for swapping operand sides: `5 < p.x` becomes `p.x > 5`.
const FLIP_OP: Partial<Record<EnginePredicateKind, EnginePredicateKind>> = {
  lt: "gt",
  lte: "gte",
  gt: "lt",
  gte: "lte",
};

/**
 * Bind a WHERE sub-tree to its planner-side `BoundPredicate`. The
 * `relation` argument names the source the engine is attached to;
 * column references that do not resolve to that relation become opaque
 * leaves so engines do not accidentally claim cross-source predicates.
 */
export function bindPredicate(
  expr: LuaExpression | undefined,
  relation: string,
): BoundPredicate | undefined {
  if (!expr) return undefined;
  return bindNode(expr, relation);
}

function bindNode(expr: LuaExpression, relation: string): BoundPredicate {
  switch (expr.type) {
    case "Parenthesized":
      return bindParenthesized(expr, relation);

    case "Binary":
      return bindBinary(expr, relation);

    case "Unary":
      return bindUnary(expr, relation);

    case "QueryIn":
      return bindQueryIn(expr, relation);

    case "PropertyAccess":
    case "Variable": {
      // Bare `p.col` (or unqualified `col` when the source has no
      // alias) used as a conjunct is a Lua truthiness check. Cached
      // augmentation values are non-boolean (timestamps etc.) so a
      // present value is truthy iff non-nil; we normalise to an
      // `is-not-nil` leaf.
      const col = columnReferenceFor(expr, relation);
      if (col) {
        return makeLeaf("is-not-nil", relation, col, undefined, expr);
      }
      return makeOpaque(expr, relation);
    }

    default:
      return makeOpaque(expr, relation);
  }
}

function bindParenthesized(
  expr: LuaParenthesizedExpression,
  relation: string,
): BoundPredicate {
  const inner = bindNode(expr.expression, relation);
  return replaceExprField(inner, expr);
}

function replaceExprField(
  pred: BoundPredicate,
  outer: LuaExpression,
): BoundPredicate {
  switch (pred.kind) {
    case "leaf":
      return { ...pred, expr: outer };
    case "composite":
      return { ...pred, expr: outer };
    case "opaque":
      return { ...pred, expr: outer };
  }
}

function bindBinary(
  expr: LuaBinaryExpression,
  relation: string,
): BoundPredicate {
  if (expr.operator === "and" || expr.operator === "or") {
    const composite: BoundCompositePredicate = {
      kind: "composite",
      op: expr.operator === "and" ? "and" : "or",
      children: [bindNode(expr.left, relation), bindNode(expr.right, relation)],
      expr,
    };
    if (composite.op === "or") {
      // "OR of same column EQ" into "IN" normalisation. Queries like
      // `where p.tag == 'page' or p.tag == 'doc'`
      // collapse to a single `in` leaf so engines that advertise `in`
      // (the bitmap engine in particular) can claim them.
      return tryCollapseOrToIn(composite, relation);
    }
    return composite;
  }

  const opKind = COMPARISON_OP_TO_KIND[expr.operator];
  if (!opKind) {
    return makeOpaque(expr, relation);
  }

  return bindComparison(expr, opKind, relation);
}

function bindComparison(
  expr: LuaBinaryExpression,
  opKind: EnginePredicateKind,
  relation: string,
): BoundPredicate {
  const left = expr.left;
  const right = expr.right;

  const leftColumn = columnReferenceFor(left, relation);
  const rightColumn = columnReferenceFor(right, relation);

  const leftLiteral = literalBoundValue(left);
  const rightLiteral = literalBoundValue(right);

  // Special case: `p.col == nil` / `nil == p.col` / `p.col ~= nil` /
  // `nil ~= p.col`. Collapse to `is-nil` / `is-not-nil` leaves so
  // engines see the canonical shape regardless of how the user spelled
  // the check. Only `eq` / `neq` participate; range comparisons against
  // nil are runtime errors in Lua.
  if (opKind === "eq" || opKind === "neq") {
    const isNilOp: EnginePredicateKind =
      opKind === "eq" ? "is-nil" : "is-not-nil";
    if (leftColumn && right.type === "Nil") {
      return makeLeaf(isNilOp, relation, leftColumn, undefined, expr);
    }
    if (rightColumn && left.type === "Nil") {
      return makeLeaf(isNilOp, relation, rightColumn, undefined, expr);
    }
  }

  // column on left, literal on right - emit directly
  if (leftColumn && rightLiteral) {
    return makeLeaf(opKind, relation, leftColumn, rightLiteral, expr);
  }

  // literal on left, column on right - flip the operator
  if (rightColumn && leftLiteral) {
    const flipped = FLIP_OP[opKind] ?? opKind;
    return makeLeaf(flipped, relation, rightColumn, leftLiteral, expr);
  }

  // column-on-left, column-on-right - cross-column comparison
  if (leftColumn && rightColumn) {
    const value: BoundValue = {
      kind: "column",
      relation,
      column: rightColumn,
    };
    return makeLeaf(opKind, relation, leftColumn, value, expr);
  }
  if (rightColumn && leftColumn === undefined && leftLiteral === undefined) {
    // right is a column on our relation, left is something exotic
    // (function call etc.) - flip and emit
    const flipped = FLIP_OP[opKind] ?? opKind;
    return makeLeaf(
      flipped,
      relation,
      rightColumn,
      { kind: "opaque", expr: left },
      expr,
    );
  }

  // column-on-left, exotic-on-right - opaque value
  if (leftColumn) {
    return makeLeaf(
      opKind,
      relation,
      leftColumn,
      { kind: "opaque", expr: right },
      expr,
    );
  }

  // neither side references the relation - fully opaque
  return makeOpaque(expr, relation);
}

function bindUnary(expr: LuaUnaryExpression, relation: string): BoundPredicate {
  if (expr.operator === "not") {
    // Special case: `not p.col` (bare column negation) to `is-nil`
    const inner = expr.argument;
    if (inner.type === "PropertyAccess" || inner.type === "Variable") {
      const col = columnReferenceFor(inner, relation);
      if (col) {
        return makeLeaf("is-nil", relation, col, undefined, expr);
      }
    }
    return {
      kind: "composite",
      op: "not",
      children: [bindNode(expr.argument, relation)],
      expr,
    };
  }
  // arithmetic unary (`-x`, `#x`) inside a WHERE clause is unusual and
  // not pushable - treat as opaque
  return makeOpaque(expr, relation);
}

function bindQueryIn(
  expr: LuaQueryInExpression,
  relation: string,
): BoundPredicate {
  const column = columnReferenceFor(expr.left, relation);
  const values = literalValuesFromTableConstructor(expr.right);
  if (!column || !values) {
    return makeOpaque(expr, relation);
  }
  if (values.length === 0) {
    // `x in {}` is always false at the language level. We do NOT
    // collapse it here; that's a constant-folding concern. Emit a
    // leaf with empty values so engines can choose to short-circuit.
    return makeLeaf("in", relation, column, undefined, expr, []);
  }
  if (values.length === 1) {
    // Single-element IN collapses to equality. Bitmap eq lookup is
    // strictly cheaper than IN's union, so the planner benefits from
    // seeing it as an `eq` leaf.
    return makeLeaf("eq", relation, column, values[0], expr);
  }
  return makeLeaf("in", relation, column, undefined, expr, values);
}

// Helpers

function columnReferenceFor(
  expr: LuaExpression,
  relation: string,
): string | undefined {
  if (
    expr.type === "PropertyAccess" &&
    expr.object.type === "Variable" &&
    expr.object.name === relation
  ) {
    return expr.property;
  }
  return undefined;
}

function literalBoundValue(expr: LuaExpression): BoundValue | undefined {
  switch (expr.type) {
    case "String":
      return { kind: "literal-string", value: expr.value };
    case "Number":
      return { kind: "literal-number", value: expr.value };
    case "Boolean":
      return { kind: "literal-boolean", value: expr.value };
    case "Nil":
      return { kind: "literal-nil" };
    default:
      return undefined;
  }
}

function literalValuesFromTableConstructor(
  expr: LuaExpression,
): BoundValue[] | undefined {
  if (expr.type !== "TableConstructor") return undefined;
  const out: BoundValue[] = [];
  for (const field of expr.fields) {
    let valueExpr: LuaExpression | undefined;
    if (field.type === "ExpressionField") valueExpr = field.value;
    else if (field.type === "PropField") valueExpr = field.value;
    else return undefined;
    const bv = literalBoundValue(valueExpr);
    if (!bv) return undefined;
    out.push(bv);
  }
  return out;
}

function makeLeaf(
  op: EnginePredicateKind,
  relation: string,
  column: string,
  value: BoundValue | undefined,
  expr: LuaExpression,
  values?: BoundValue[],
): BoundLeafPredicate {
  return { kind: "leaf", relation, column, op, value, values, expr };
}

function makeOpaque(
  expr: LuaExpression,
  relation: string,
): BoundOpaquePredicate {
  return { kind: "opaque", relation, expr };
}

// "OR of same column EQ" into "IN"
//
// Walks the (already bound) OR composite, flattens nested OR-children,
// and if EVERY descendant is an `eq` or `in` leaf on the same
// (relation, column) with literal values collapses the whole tree
// into one `in` leaf.
function tryCollapseOrToIn(
  composite: BoundCompositePredicate,
  relation: string,
): BoundPredicate {
  const flattened = flattenOrChildren(composite);

  let column: string | undefined;
  const values: BoundValue[] = [];

  for (const child of flattened) {
    if (child.kind !== "leaf") return composite;
    if (child.relation !== relation) return composite;

    if (column === undefined) {
      column = child.column;
    } else if (child.column !== column) {
      return composite;
    }

    if (child.op === "eq") {
      if (!child.value || !isLiteralBoundValue(child.value)) return composite;
      values.push(child.value);
    } else if (child.op === "in") {
      if (!child.values || child.values.length === 0) return composite;
      for (const v of child.values) {
        if (!isLiteralBoundValue(v)) return composite;
        values.push(v);
      }
    } else {
      return composite;
    }
  }

  if (column === undefined || values.length === 0) return composite;

  // A single value reduces to `eq`; >1 stays as `in`.
  if (values.length === 1) {
    return makeLeaf("eq", relation, column, values[0], composite.expr);
  }
  return makeLeaf("in", relation, column, undefined, composite.expr, values);
}

function flattenOrChildren(pred: BoundPredicate): BoundPredicate[] {
  if (pred.kind === "composite" && pred.op === "or") {
    return pred.children.flatMap(flattenOrChildren);
  }
  return [pred];
}

function isLiteralBoundValue(v: BoundValue): boolean {
  return (
    v.kind === "literal-string" ||
    v.kind === "literal-number" ||
    v.kind === "literal-boolean"
  );
}
