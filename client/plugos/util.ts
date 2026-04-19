/**
 * Deep-clone a value, replacing any functions with null.
 * Needed because values containing functions can't be serialized
 * via postMessage or validated with JSON Schema.
 */
export function stripFunctions(value: any): any {
  if (typeof value === "function") return null;
  if (value === null || value === undefined || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(stripFunctions);
  }
  const result: Record<string, any> = {};
  for (const key of Object.keys(value)) {
    result[key] = stripFunctions(value[key]);
  }
  return result;
}

/**
 * Checks if an object is sendable across the plugos worker boundary.
 *
 * @param o - The object to check.
 * @returns `true` if the object is sendable, `false` otherwise.
 */
export function isSendable(o: any): boolean {
  try {
    structuredClone(o);
    return true;
  } catch {
    return false;
  }
}
