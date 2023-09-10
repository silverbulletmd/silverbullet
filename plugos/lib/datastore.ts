import { KvKey, KvPrimitives } from "./kv_primitives.ts";

export type { KvKey };

export type KvValue = any;

export type KV = {
  key: KvKey;
  value: KvValue;
};

export type KvOrderBy = {
  attribute: string;
  desc: boolean;
};

export type KvSelect = {
  name: string;
  expr?: KvQueryExpression;
};

export type KvQuery = {
  prefix: KvKey;
  filter?: KvQueryFilter;
  orderBy?: KvOrderBy[];
  select?: KvSelect[];
  limit?: number;
};

export type KvQueryFilter =
  | ["and", KvQueryFilter, KvQueryFilter]
  | ["or", KvQueryFilter, KvQueryFilter]
  | ["=", KvQueryExpression, KvQueryExpression]
  | ["!=", KvQueryExpression, KvQueryExpression]
  | ["=~", KvQueryExpression, KvQueryExpression]
  | ["!=~", KvQueryExpression, KvQueryExpression]
  | ["<", KvQueryExpression, KvQueryExpression]
  | ["<=", KvQueryExpression, KvQueryExpression]
  | [">", KvQueryExpression, KvQueryExpression]
  | [">=", KvQueryExpression, KvQueryExpression]
  | ["in", KvQueryExpression, KvQueryExpression];

export type KvQueryExpression =
  | ["attr", string]
  | ["number", number]
  | ["string", string]
  | ["boolean", boolean]
  | ["null"]
  | ["array", KvQueryExpression[]]
  | ["object", Record<string, any>]
  | ["regexp", RegExp]
  | ["binop", string, KvQueryExpression, KvQueryExpression]
  | ["call", string, KvQueryExpression[]];

type KvFunctionMap = Record<string, (...args: any[]) => any>;

export function evalKvQueryExpression(
  val: KvQueryExpression,
  obj: any,
  functionMap: KvFunctionMap = {},
): any {
  const [type, val2] = val;
  switch (type) {
    case "null":
      return null;
    case "number":
    case "string":
    case "boolean":
    case "regexp":
      return val2;
    case "attr": {
      let attributeVal = obj;
      for (const part of val2.split(".")) {
        if (!part) {
          return attributeVal;
        }
        if (attributeVal === undefined) {
          return attributeVal;
        }
        attributeVal = attributeVal[part];
      }
      return attributeVal;
    }
    case "array":
      return val2.map((v) => evalKvQueryExpression(v, obj, functionMap));
    case "object":
      return obj;
    case "binop": {
      const [_binop, op, op1, op2] = val;
      const v1 = evalKvQueryExpression(op1, obj, functionMap);
      const v2 = evalKvQueryExpression(op2, obj, functionMap);
      switch (op) {
        case "+":
          return v1 + v2;
        case "-":
          return v1 - v2;
        case "*":
          return v1 * v2;
        case "/":
          return v1 / v2;
        case "%":
          return v1 % v2;
        default:
          throw new Error(`Unsupported binary operator: ${op}`);
      }
    }
    case "call": {
      const fn = functionMap[val2];
      if (!fn) {
        throw new Error(`Unknown function: ${val2}`);
      }
      return fn(
        ...val[2].map((v) => evalKvQueryExpression(v, obj, functionMap)),
      );
    }
    default:
      throw new Error(`Unsupported value type: ${type}`);
  }
}

export function jsValueToKvQueryExpression(val: any): KvQueryExpression {
  if (val === null) {
    return ["null"];
  } else if (typeof val === "number") {
    return ["number", val];
  } else if (typeof val === "string") {
    return ["string", val];
  } else if (typeof val === "boolean") {
    return ["boolean", val];
  } else if (Array.isArray(val)) {
    return ["array", val.map(jsValueToKvQueryExpression)];
  } else if (val instanceof RegExp) {
    return ["regexp", val];
  } else if (typeof val === "object") {
    return ["object", val];
  } else {
    throw new Error(`Unsupported value type: ${typeof val}`);
  }
}

function filterKvQuery(
  kvQuery: KvQueryFilter,
  obj: KvValue,
  functionMap: KvFunctionMap,
): boolean {
  const [op, op1, op2] = kvQuery;

  if (op === "and") {
    return filterKvQuery(op1, obj, functionMap) &&
      filterKvQuery(op2, obj, functionMap);
  } else if (op === "or") {
    return filterKvQuery(op1, obj, functionMap) ||
      filterKvQuery(op2, obj, functionMap);
  }

  const val1 = evalKvQueryExpression(op1, obj, functionMap);
  const val2 = evalKvQueryExpression(op2, obj, functionMap);

  // And apply the operator
  switch (op) {
    case "=": {
      if (Array.isArray(val1) && !Array.isArray(val2)) {
        // Record property is an array, and value is a scalar: find the value in the array
        if (val1.includes(val2)) {
          return true;
        }
      } else if (Array.isArray(val1) && Array.isArray(val2)) {
        // Record property is an array, and value is an array: find the value in the array
        if (val1.some((v) => val2.includes(v))) {
          return true;
        }
      }

      return val1 === val2;
    }
    case "!=":
      return val1 !== val2;
    case "=~":
      return val2.test(val1);
    case "!=~":
      return !val2.test(val1);
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
      throw new Error(`Unupported operator: ${op}`);
  }
}

/**
 * This is the data store class you'll actually want to use, wrapping the primitives
 * in a more user-friendly way
 */
export class DataStore {
  constructor(
    private kv: KvPrimitives,
    private functionMap: KvFunctionMap = {},
  ) {
  }

  async get(key: KvKey): Promise<KvValue> {
    return (await this.kv.batchGet([key]))[0];
  }

  batchGet(keys: KvKey[]): Promise<KvValue[]> {
    return this.kv.batchGet(keys);
  }

  set(key: KvKey, value: KvValue): Promise<void> {
    return this.kv.batchSet([{ key, value }]);
  }

  batchSet(entries: KV[]): Promise<void> {
    return this.kv.batchSet(entries);
  }

  delete(key: KvKey): Promise<void> {
    return this.kv.batchDelete([key]);
  }

  batchDelete(keys: KvKey[]): Promise<void> {
    return this.kv.batchDelete(keys);
  }

  async query(query: KvQuery): Promise<KV[]> {
    const results: KV[] = [];
    let itemCount = 0;
    // Accumuliate results
    for await (const entry of this.kv.query({ prefix: query.prefix })) {
      // Filter
      if (
        query.filter &&
        !filterKvQuery(query.filter, entry.value, this.functionMap)
      ) {
        continue;
      }
      results.push(entry);
      itemCount++;
      // Stop when the limit has been reached
      if (itemCount === query.limit) {
        break;
      }
    }
    // Order by
    if (query.orderBy) {
      results.sort((a, b) => {
        const aVal = a.value;
        const bVal = b.value;
        for (const { attribute, desc } of query.orderBy!) {
          if (
            aVal[attribute] < bVal[attribute] || aVal[attribute] === undefined
          ) {
            return desc ? 1 : -1;
          }
          if (
            aVal[attribute] > bVal[attribute] || bVal[attribute] === undefined
          ) {
            return desc ? -1 : 1;
          }
        }
        // Consider them equal. This helps with comparing arrays (like tags)
        return 0;
      });
    }

    if (query.select) {
      for (let i = 0; i < results.length; i++) {
        const rec = results[i].value;
        const newRec: any = {};
        for (const { name, expr } of query.select) {
          newRec[name] = expr
            ? evalKvQueryExpression(expr, rec, this.functionMap)
            : rec[name];
        }
        results[i].value = newRec;
      }
    }
    return results;
  }
}
