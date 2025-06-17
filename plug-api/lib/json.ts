/**
 * Performs a deep comparison of two objects, returning true if they are equal
 * @param a first object
 * @param b second object
 * @returns
 */
export function deepEqual(a: any, b: any): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a !== typeof b) {
    return false;
  }
  if (a === null || b === null) {
    return false;
  }
  if (a === undefined || b === undefined) {
    return false;
  }
  if (typeof a === "object") {
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) {
        return false;
      }
      for (let i = 0; i < a.length; i++) {
        if (!deepEqual(a[i], b[i])) {
          return false;
        }
      }
      return true;
    } else {
      const aKeys = Object.keys(a);
      const bKeys = Object.keys(b);
      if (aKeys.length !== bKeys.length) {
        return false;
      }
      for (const key of aKeys) {
        if (!deepEqual(a[key], b[key])) {
          return false;
        }
      }
      return true;
    }
  }
  return false;
}

/**
 * Converts a Date object to a date string in the format YYYY-MM-DD if it just contains a date (and no significant time), or a full ISO string otherwise
 * @param d the date to convert
 */
export function cleanStringDate(d: Date): string {
  // If no significant time, return a date string only
  if (
    d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0
  ) {
    return d.getUTCFullYear() + "-" +
      String(d.getUTCMonth() + 1).padStart(2, "0") + "-" +
      String(d.getUTCDate()).padStart(2, "0");
  } else {
    return d.toISOString();
  }
}

/**
 * Processes a JSON (typically coming from parse YAML frontmatter) in two ways:
 * 1. Expands property names in an object containing a .-separated path
 * 2. Converts dates to strings in sensible ways
 * @param a
 * @returns
 */
export function cleanupJSON(a: any): any {
  if (!a) {
    return a;
  }
  if (typeof a !== "object") {
    return a;
  }
  if (Array.isArray(a)) {
    return a.map(cleanupJSON);
  }
  // If a is a date, convert to a string
  if (a instanceof Date) {
    return cleanStringDate(a);
  }
  const expanded: any = {};
  for (const key of Object.keys(a)) {
    const parts = key.split(".");
    let target = expanded;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!target[part]) {
        target[part] = {};
      }
      target = target[part];
    }
    target[parts[parts.length - 1]] = cleanupJSON(a[key]);
  }
  return expanded;
}

export function deepClone<T>(obj: T, ignoreKeys: string[] = []): T {
  // Handle null, undefined, or primitive types (string, number, boolean, symbol, bigint)
  if (obj === null || typeof obj !== "object") {
    return obj;
  }

  // Handle Date
  if (obj instanceof Date) {
    return new Date(obj.getTime()) as any;
  }

  // Handle Array
  if (Array.isArray(obj)) {
    const arrClone: any[] = [];
    for (let i = 0; i < obj.length; i++) {
      arrClone[i] = deepClone(obj[i], ignoreKeys);
    }
    return arrClone as any;
  }

  // Handle Object
  if (obj instanceof Object) {
    const objClone: { [key: string]: any } = {};
    for (const key in obj) {
      if (ignoreKeys.includes(key)) {
        objClone[key] = obj[key];
      } else if (Object.prototype.hasOwnProperty.call(obj, key)) {
        objClone[key] = deepClone(obj[key], ignoreKeys);
      }
    }
    return objClone as T;
  }

  throw new Error("Unsupported data type.");
}
