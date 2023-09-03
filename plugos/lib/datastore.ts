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

export type KvQuery = {
  prefix: KvKey;
  filter?: KvQueryFilter;
  orderBy?: KvOrderBy[];
  limit?: number;
  select?: string[];
};

export type KvQueryFilter =
  | ["=", string, any]
  | ["!=", string, any]
  | ["=~", string, RegExp]
  | ["!=~", string, RegExp]
  | ["prefix", string, string]
  | ["<", string, any]
  | ["<=", string, any]
  | [">", string, any]
  | [">=", string, any]
  | ["in", string, any[]]
  | ["and", KvQueryFilter, KvQueryFilter]
  | ["or", KvQueryFilter, KvQueryFilter];

function filterKvQuery(kvQuery: KvQueryFilter, obj: KvValue): boolean {
  const [op, op1, op2] = kvQuery;

  if (op === "and") {
    return filterKvQuery(op1, obj) &&
      filterKvQuery(op2, obj);
  } else if (op === "or") {
    return filterKvQuery(op1, obj) || filterKvQuery(op2, obj);
  }

  // Look up the value of the attribute, supporting nested attributes via `attr.attr2.attr3`, and empty attribute value signifies the root object
  let attributeVal = obj;
  for (const part of op1.split(".")) {
    if (!part) {
      continue;
    }
    if (attributeVal === undefined) {
      return false;
    }
    attributeVal = attributeVal[part];
  }

  // And apply the operator
  switch (op) {
    case "=": {
      if (Array.isArray(attributeVal) && !Array.isArray(op2)) {
        // Record property is an array, and value is a scalar: find the value in the array
        if (attributeVal.includes(op2)) {
          return true;
        }
      } else if (Array.isArray(attributeVal) && Array.isArray(obj)) {
        // Record property is an array, and value is an array: find the value in the array
        if (attributeVal.some((v) => obj.includes(v))) {
          return true;
        }
      }

      return attributeVal === op2;
    }
    case "!=":
      return attributeVal !== op2;
    case "=~":
      return op2.test(attributeVal);
    case "!=~":
      return !op2.test(attributeVal);
    case "prefix":
      return attributeVal.startsWith(op2);
    case "<":
      return attributeVal < op2;
    case "<=":
      return attributeVal <= op2;
    case ">":
      return attributeVal > op2;
    case ">=":
      return attributeVal >= op2;
    case "in":
      return op2.includes(attributeVal);
    default:
      throw new Error(`Unupported operator: ${op}`);
  }
}

/**
 * This is the data store class you'll actually want to use, wrapping the primitives
 * in a more user-friendly way
 */
export class DataStore {
  constructor(private kv: KvPrimitives) {
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
      if (query.filter && !filterKvQuery(query.filter, entry.value)) {
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
        for (const k of query.select) {
          newRec[k] = rec[k];
        }
        results[i].value = newRec;
      }
    }
    return results;
  }
}
