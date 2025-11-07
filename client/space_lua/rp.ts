// Result-or-Promise helpers

export type RP<T> = T | Promise<T>;

// Returns true when v is a Promise or a has a then function.
export function isPromise<T>(v: RP<T>): v is Promise<T> {
  return v !== null && typeof v === "object" &&
    typeof (v as any).then === "function";
}

export function rpThen<A, B>(v: RP<A>, f: (a: A) => RP<B>): RP<B> {
  return isPromise(v) ? (v as Promise<A>).then(f) : f(v as A);
}

/**
 * Collect an array of Result-or-Promise values into a single array
 * avoiding Promise allocation when all inputs are synchronous.
 */
export function rpAll<T>(arr: RP<T>[]): RP<T[]> {
  let hasPromise = false;
  for (let i = 0; i < arr.length; i++) {
    if (isPromise(arr[i])) {
      hasPromise = true;
      break;
    }
  }
  if (!hasPromise) {
    // All sync values: return as-is
    return arr as T[];
  }

  // At least one Promise: allocate a new array
  const out = new Array<T | Promise<T>>(arr.length);
  for (let i = 0; i < arr.length; i++) {
    out[i] = arr[i] as any;
  }
  return Promise.all(out as Promise<T>[]);
}
