// Compares two objects deeply
export function deepEqual(a: any, b: any): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a !== typeof b) {
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

// Converts a Date object to a date string in the format YYYY-MM-DD if it just contains a date (and no significant time), or a full ISO string otherwise
export function cleanStringDate(d: Date): string {
  function pad(n: number) {
    let s = String(n);
    if (s.length === 1) {
      s = "0" + s;
    }
    return s;
  }

  // If no significant time, return a date string only
  if (
    d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0
  ) {
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" +
      pad(d.getDate());
  } else {
    return d.toISOString();
  }
}

// Processes a JSON (typically coming from parse YAML frontmatter) in two ways:
// 1. Expands property names in an object containing a .-separated path
// 2. Converts dates to strings in sensible ways
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

export function deepObjectMerge(a: any, b: any): any {
  if (typeof a !== typeof b) {
    return b;
  }
  if (typeof a === "object") {
    if (Array.isArray(a) && Array.isArray(b)) {
      return [...a, ...b];
    } else {
      const aKeys = Object.keys(a);
      const bKeys = Object.keys(b);
      const merged = { ...a };
      for (const key of bKeys) {
        if (aKeys.includes(key)) {
          merged[key] = deepObjectMerge(a[key], b[key]);
        } else {
          merged[key] = b[key];
        }
      }
      return merged;
    }
  }
  return b;
}
