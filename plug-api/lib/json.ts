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

// Expands property names in an object containing a .-separated path
export function expandPropertyNames(a: any): any {
  if (!a) {
    return a;
  }
  if (typeof a !== "object") {
    return a;
  }
  if (Array.isArray(a)) {
    return a.map(expandPropertyNames);
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
    target[parts[parts.length - 1]] = expandPropertyNames(a[key]);
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
