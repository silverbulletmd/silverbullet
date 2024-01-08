import { BSON } from "https://esm.sh/bson@6.2.0";

// BSON doesn't support top-level primitives, so we need to wrap them in an object
const topLevelValueKey = "$_tl";

// BSON doesn't support undefined, so we need to encode it as a "magic" string
const undefinedPlaceHolder = "$_undefined_$";

/**
 * BSON encoder, but also supporting "edge cases" like encoding strings, numbers, etc.
 * @param obj
 * @returns
 */
export function encodeBSON(obj: any): Uint8Array {
  if (
    obj === undefined || obj === null ||
    !(typeof obj === "object" && obj.constructor === Object)
  ) {
    obj = { [topLevelValueKey]: obj };
  }
  obj = traverseAndRewriteJSON(obj, (val) => {
    if (val === undefined) {
      return undefinedPlaceHolder;
    }
    return val;
  });
  return BSON.serialize(obj);
}

export function decodeBSON(data: Uint8Array): any {
  let result = BSON.deserialize(data);
  // For whatever reason the BSON library doesn't unwrap binary blobs automatically
  result = traverseAndRewriteJSON(result, (val) => {
    if (typeof val?.value === "function") {
      return val.value();
    } else if (val === undefinedPlaceHolder) {
      return undefined;
    }
    return val;
  });
  if (Object.hasOwn(result, topLevelValueKey)) {
    return result[topLevelValueKey];
  } else {
    return result;
  }
}

/**
 * Traverses and rewrites an object recursively.
 *
 * @param obj - The object to traverse and rewrite.
 * @param rewrite - The function to apply for rewriting each value.
 * @returns The rewritten object.
 */
export function traverseAndRewriteJSON(
  obj: any,
  rewrite: (val: any) => any,
): any {
  // Apply rewrite to object as a whole
  obj = rewrite(obj);
  // Recurse down if this is an array or a "plain object"
  if (
    obj && (Array.isArray(obj) ||
      (typeof obj === "object" && obj.constructor === Object))
  ) {
    const keys = Object.keys(obj);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      obj[key] = traverseAndRewriteJSON(obj[key], rewrite);
    }
  }
  return obj;
}
