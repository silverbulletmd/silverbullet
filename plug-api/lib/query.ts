import { FunctionMap, KV, Query, QueryExpression } from "$sb/types.ts";

export function evalQueryExpression(
  val: QueryExpression,
  obj: any,
  functionMap: FunctionMap = {},
): any {
  const [type, op1] = val;

  switch (type) {
    // Logical operators
    case "and":
      return evalQueryExpression(op1, obj, functionMap) &&
        evalQueryExpression(val[2], obj, functionMap);
    case "or":
      return evalQueryExpression(op1, obj, functionMap) ||
        evalQueryExpression(val[2], obj, functionMap);
    // Value types
    case "null":
      return null;
    // TODO: Add this to the actualy query syntax
    case "not":
      return !evalQueryExpression(op1, obj, functionMap);
    case "number":
    case "string":
    case "boolean":
      return op1;
    case "regexp":
      return [op1, val[2]];
    case "attr": {
      let attributeVal = obj;
      if (val.length === 3) {
        attributeVal = evalQueryExpression(val[1], obj, functionMap);
        if (attributeVal) {
          return attributeVal[val[2]];
        } else {
          return null;
        }
      } else if (!val[1]) {
        return obj;
      } else {
        return attributeVal[val[1]];
      }
    }
    case "array": {
      return op1.map((v) => evalQueryExpression(v, obj, functionMap));
    }
    case "object":
      return obj;
    case "call": {
      const fn = functionMap[op1];
      if (!fn) {
        throw new Error(`Unknown function: ${op1}`);
      }
      return fn(
        ...val[2].map((v) => evalQueryExpression(v, obj, functionMap)),
      );
    }
  }

  // Binary operators, here we can pre-calculate the two operand values
  const val1 = evalQueryExpression(op1, obj, functionMap);
  const val2 = evalQueryExpression(val[2], obj, functionMap);

  switch (type) {
    case "+":
      return val1 + val2;
    case "-":
      return val1 - val2;
    case "*":
      return val1 * val2;
    case "/":
      return val1 / val2;
    case "%":
      return val1 % val2;
    case "=": {
      if (Array.isArray(val1) && !Array.isArray(val2)) {
        // Record property is an array, and value is a scalar: find the value in the array
        return val1.includes(val2);
      } else if (Array.isArray(val1) && Array.isArray(val2)) {
        // Record property is an array, and value is an array: compare the arrays
        return val1.length === val2.length &&
          val1.every((v) => val2.includes(v));
      }
      return val1 == val2;
    }
    case "!=": {
      if (Array.isArray(val1) && !Array.isArray(val2)) {
        // Record property is an array, and value is a scalar: find the value in the array
        return !val1.includes(val2);
      } else if (Array.isArray(val1) && Array.isArray(val2)) {
        // Record property is an array, and value is an array: compare the arrays
        return !(val1.length === val2.length &&
          val1.every((v) => val2.includes(v)));
      }
      return val1 != val2;
    }
    case "=~": {
      if (!Array.isArray(val2)) {
        throw new Error(`Invalid regexp: ${val2}`);
      }
      const r = new RegExp(val2[0], val2[1]);
      return r.test(val1);
    }
    case "!=~": {
      if (!Array.isArray(val2)) {
        throw new Error(`Invalid regexp: ${val2}`);
      }
      const r = new RegExp(val2[0], val2[1]);
      return !r.test(val1);
    }
    case "<":
      return val1 < val2;
    case "<=":
      return val1 <= val2;
    case ">":
      return val1 > val2;
    case ">=":
      return val1 >= val2;
    case "in":
      return val2.includes(val1);
    default:
      throw new Error(`Unupported operator: ${type}`);
  }
}

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

export function applyQuery<T>(query: Query, allItems: T[]): T[] {
  // Filter
  if (query.filter) {
    allItems = allItems.filter((item) =>
      evalQueryExpression(query.filter!, item)
    );
  }
  // Add dummy keys, then remove them
  return applyQueryNoFilterKV(
    query,
    allItems.map((v) => ({ key: [], value: v })),
  ).map((v) => v.value);
}

export function applyQueryNoFilterKV(
  query: Query,
  allItems: KV[],
  functionMap: FunctionMap = {}, // TODO: Figure this out later
): KV[] {
  // Order by
  if (query.orderBy) {
    allItems = allItems.sort((a, b) => {
      const aVal = a.value;
      const bVal = b.value;
      for (const { expr, desc } of query.orderBy!) {
        const evalA = evalQueryExpression(expr, aVal, functionMap);
        const evalB = evalQueryExpression(expr, bVal, functionMap);
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
          ? evalQueryExpression(expr, rec, functionMap)
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
    const limit = evalQueryExpression(query.limit, {}, functionMap);
    if (allItems.length > limit) {
      allItems = allItems.slice(0, limit);
    }
  }
  return allItems;
}
