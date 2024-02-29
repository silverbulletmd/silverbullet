import { FunctionMap, KV, Query, QueryExpression } from "../types.ts";
import { evalQueryExpression } from "./query_expression.ts";

/**
 * Looks for an attribute assignment in the expression, and returns the expression assigned to the attribute or throws an error when not found
 * Side effect: effectively removes the attribute assignment from the expression (by replacing it with true = true)
 */
export function liftAttributeFilter(
  expression: QueryExpression | undefined,
  attributeName: string,
): QueryExpression {
  if (!expression) {
    throw new Error(`Cannot find attribute assignment for ${attributeName}`);
  }
  switch (expression[0]) {
    case "=": {
      if (expression[1][0] === "attr" && expression[1][1] === attributeName) {
        const val = expression[2];
        // Remove the filter by changing it to true = true
        expression[1] = ["boolean", true];
        expression[2] = ["boolean", true];
        return val;
      }
      break;
    }
    case "and":
    case "or": {
      const newOp1 = liftAttributeFilter(expression[1], attributeName);
      if (newOp1) {
        return newOp1;
      }
      const newOp2 = liftAttributeFilter(expression[2], attributeName);
      if (newOp2) {
        return newOp2;
      }
      throw new Error(`Cannot find attribute assignment for ${attributeName}`);
    }
  }
  throw new Error(`Cannot find attribute assignment for ${attributeName}`);
}

export async function applyQuery<T>(
  query: Query,
  allItems: T[],
  variables: Record<string, any>,
  functionMap: FunctionMap,
): Promise<T[]> {
  // Filter
  if (query.filter) {
    const filteredItems: T[] = [];
    for (const item of allItems) {
      if (
        await evalQueryExpression(
          query.filter,
          item,
          variables,
          functionMap,
        )
      ) {
        filteredItems.push(item);
      }
    }
    allItems = filteredItems;
  }
  // Add dummy keys, then remove them
  return (await applyQueryNoFilterKV(
    query,
    allItems.map((v) => ({ key: [], value: v })),
    variables,
    functionMap,
  )).map((v) => v.value);
}

export async function applyQueryNoFilterKV(
  query: Query,
  allItems: KV[],
  variables: Record<string, any>,
  functionMap: FunctionMap,
): Promise<KV[]> {
  // Order by
  if (query.orderBy) {
    allItems = allItems.sort((a, b) => {
      const aVal = a.value;
      const bVal = b.value;
      for (const { expr, desc } of query.orderBy!) {
        const evalA = evalQueryExpression(
          expr,
          aVal,
          variables,
          functionMap,
        );
        if (evalA instanceof Promise) {
          throw new Error("Cannot order by a promise");
        }
        const evalB = evalQueryExpression(
          expr,
          bVal,
          variables,
          functionMap,
        );
        if (evalB instanceof Promise) {
          throw new Error("Cannot order by a promise");
        }
        if (
          evalA < evalB || evalA === undefined
        ) {
          return desc ? 1 : -1;
        }
        if (
          evalA > evalB || evalB === undefined
        ) {
          return desc ? -1 : 1;
        }
      }
      // Consider them equal. This helps with comparing arrays (like tags)
      return 0;
    });
  }

  if (query.select) {
    for (let i = 0; i < allItems.length; i++) {
      const rec = allItems[i].value;
      const newRec: any = {};
      for (const { name, expr } of query.select) {
        newRec[name] = expr
          ? await evalQueryExpression(expr, rec, variables, functionMap)
          : rec[name];
      }
      allItems[i].value = newRec;
    }
  }
  if (query.distinct) {
    // Remove duplicates
    const valueSet = new Set<string>();
    const uniqueItems: KV[] = [];
    for (const item of allItems) {
      const value = JSON.stringify(item.value);
      if (!valueSet.has(value)) {
        valueSet.add(value);
        uniqueItems.push(item);
      }
    }
    allItems = uniqueItems;
  }

  if (query.limit) {
    const limit = await evalQueryExpression(
      query.limit,
      {},
      variables,
      functionMap,
    );
    if (allItems.length > limit) {
      allItems = allItems.slice(0, limit);
    }
  }
  return allItems;
}
