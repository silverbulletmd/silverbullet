/**
 * Bitmap Predicate Analyzer: performs static analysis of SLIQ `where`
 * expressions (no evaluation) to extract simple equality predicates
 * resolvable by bitmap index lookup.
 *
 * The result is a set of candidate object IDs that MIGHT match.
 *
 * The full SLIQ `where` expression is always evaluated afterwards;
 * bitmaps only narrow the KV scan, they never replace Lua evaluation.
 *
 * The analyzer is conservative: when in doubt, it does NOT filter.
 */

import type {
  LuaExpression,
  LuaBinaryExpression,
  LuaPropertyAccessExpression,
  LuaVariable,
} from "../../space_lua/ast.ts";
import { RoaringBitmap } from "./roaring_bitmap.ts";
import type { BitmapIndex } from "./bitmap_index.ts";

// Result of bitmap predicate analysis
export type BitmapPrefilterResult = {
  candidateIds: RoaringBitmap;
  resolvedColumns: string[];
};

/**
 * Analyze a where expression to extract a bitmap pre-filter.
 *
 * Returns null if no predicates could be resolved (caller does full scan).
 * When non-null, caller should:
 *
 * 1. Fetch only objects whose IDs are in candidateIds
 * 2. Still evaluate the full where expression on each fetched object
 */
export function analyzeBitmapPrefilter(
  expr: LuaExpression,
  tagId: number,
  objectVariable: string | undefined,
  bitmapIndex: BitmapIndex,
): BitmapPrefilterResult | null {
  const ctx: AnalysisContext = {
    tagId,
    objectVariable,
    bitmapIndex,
    resolvedColumns: [],
  };

  // Flatten the AND chain
  const conjuncts = flattenAnd(expr);

  // Try to resolve each conjunct independently.
  // For AND semantics: intersect all resolved bitmaps.
  // Unresolvable conjuncts are ignored (Lua eval handles them).
  let result: RoaringBitmap | null = null;

  for (const conjunct of conjuncts) {
    const bitmap = resolveConjunct(conjunct, ctx);
    if (bitmap) {
      if (result === null) {
        result = bitmap;
      } else {
        result = RoaringBitmap.and(result, bitmap);
      }
    }
  }

  if (result === null) return null;

  return {
    candidateIds: result,
    resolvedColumns: ctx.resolvedColumns,
  };
}

// Internal

type AnalysisContext = {
  tagId: number;
  objectVariable: string | undefined;
  bitmapIndex: BitmapIndex;
  resolvedColumns: string[];
};

// Flatten `and` chains into individual conjuncts.
function flattenAnd(expr: LuaExpression): LuaExpression[] {
  if (expr.type === "Binary" && expr.operator === "and") {
    const bin = expr as LuaBinaryExpression;
    return [...flattenAnd(bin.left), ...flattenAnd(bin.right)];
  }
  if (expr.type === "Parenthesized") {
    return flattenAnd((expr as { expression: LuaExpression }).expression);
  }
  return [expr];
}

// Try to resolve a single conjunct to a bitmap
function resolveConjunct(
  expr: LuaExpression,
  ctx: AnalysisContext,
): RoaringBitmap | null {
  if (expr.type !== "Binary") return null;
  const bin = expr as LuaBinaryExpression;

  if (bin.operator === "==") {
    return resolveEquality(bin, ctx);
  }

  if (bin.operator === "~=") {
    return resolveInequality(bin, ctx);
  }

  // Other operators
  return null;
}

// `column == literal` -> lookup the bitmap for that value
function resolveEquality(
  expr: LuaBinaryExpression,
  ctx: AnalysisContext,
): RoaringBitmap | null {
  const pair =
    extractColumnAndLiteral(expr.left, expr.right, ctx) ??
    extractColumnAndLiteral(expr.right, expr.left, ctx);

  if (!pair) return null;

  const { column, value } = pair;
  const dict = ctx.bitmapIndex.getDictionary();
  const valueId = dict.tryEncode(value);

  if (valueId === undefined) {
    // Value not in dictionary -> no objects can match
    ctx.resolvedColumns.push(column);
    return new RoaringBitmap();
  }

  const bitmap = ctx.bitmapIndex.getBitmap(ctx.tagId, column, valueId);
  if (!bitmap) {
    ctx.resolvedColumns.push(column);
    return new RoaringBitmap();
  }

  ctx.resolvedColumns.push(column);
  return bitmap; // Caller will clone if needed
}

// `column ~= literal` -> all objects with this column minus objects
// with this value.
function resolveInequality(
  expr: LuaBinaryExpression,
  ctx: AnalysisContext,
): RoaringBitmap | null {
  const pair =
    extractColumnAndLiteral(expr.left, expr.right, ctx) ??
    extractColumnAndLiteral(expr.right, expr.left, ctx);

  if (!pair) return null;

  const { column, value } = pair;
  const allBitmaps = ctx.bitmapIndex.getColumnBitmaps(ctx.tagId, column);
  if (!allBitmaps || allBitmaps.length === 0) return null;

  // Union all value bitmaps for this column
  let allObjects = allBitmaps[0].clone();
  for (let i = 1; i < allBitmaps.length; i++) {
    allObjects = RoaringBitmap.or(allObjects, allBitmaps[i]);
  }

  const dict = ctx.bitmapIndex.getDictionary();
  const valueId = dict.tryEncode(value);
  if (valueId === undefined) {
    // Value not in dictionary -> nothing to exclude
    ctx.resolvedColumns.push(column);
    return allObjects;
  }

  const valueBitmap = ctx.bitmapIndex.getBitmap(ctx.tagId, column, valueId);
  if (!valueBitmap) {
    ctx.resolvedColumns.push(column);
    return allObjects;
  }

  ctx.resolvedColumns.push(column);
  return RoaringBitmap.andNot(allObjects, valueBitmap);
}

// AST pattern matching (no eval)

type ColumnLiteralPair = {
  column: string;
  value: unknown;
};

function extractColumnAndLiteral(
  colExpr: LuaExpression,
  valExpr: LuaExpression,
  ctx: AnalysisContext,
): ColumnLiteralPair | null {
  const column = extractColumnName(colExpr, ctx);
  if (!column) return null;

  const value = extractLiteral(valExpr);
  if (value === undefined) return null;

  return { column, value };
}

function extractColumnName(
  expr: LuaExpression,
  ctx: AnalysisContext,
): string | null {
  if (expr.type === "PropertyAccess") {
    const pa = expr as LuaPropertyAccessExpression;
    if (pa.object.type === "Variable") {
      const varName = (pa.object as LuaVariable).name;
      if (ctx.objectVariable && varName === ctx.objectVariable) {
        return pa.property;
      }
    }
    return null;
  }

  if (expr.type === "Variable") {
    if (!ctx.objectVariable) {
      return (expr as LuaVariable).name;
    }
    return null;
  }

  return null;
}

function extractLiteral(expr: LuaExpression): unknown | undefined {
  switch (expr.type) {
    case "String":
      return (expr as { value: string }).value;
    case "Number":
      return (expr as { value: number }).value;
    case "Boolean":
      return (expr as { value: boolean }).value;
    case "Nil":
      return null;
    default:
      return undefined; // Not a literal -> skip
  }
}
