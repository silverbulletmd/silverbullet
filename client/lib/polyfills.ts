// Source: https://github.com/ungap/with-resolvers/blob/main/index.js
Promise.withResolvers ||
  (Promise.withResolvers = function withResolvers<T>() {
    let a: ((value: T | PromiseLike<T>) => void) | undefined,
      b: ((reason?: unknown) => void) | undefined;
    const c = new Promise<T>((resolve, reject) => {
      a = resolve;
      b = reject;
    });
    return { resolve: a!, reject: b!, promise: c };
  });
