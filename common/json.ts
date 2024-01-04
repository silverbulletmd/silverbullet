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
    obj && Array.isArray(obj) ||
    (typeof obj === "object" && obj.constructor === Object)
  ) {
    const keys = Object.keys(obj);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      obj[key] = traverseAndRewriteJSON(obj[key], rewrite);
    }
  }
  return obj;
}
