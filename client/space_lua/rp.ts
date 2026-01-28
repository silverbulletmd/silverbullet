// Result-or-Promise helpers

export type RP<T> = T | Promise<T>;

// Returns true when v is a Promise or a has a then function.
export function isPromise<T>(v: RP<T>): v is Promise<T> {
  return v !== null &&
    (typeof v === "object" || typeof v === "function") &&
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
  for (let i = 0; i < arr.length; i++) {
    if (isPromise(arr[i])) {
      return Promise.all(arr as Promise<T>[]);
    }
  }
  return arr as T[];
}
