// Source: https://github.com/ungap/with-resolvers/blob/main/index.js
// @ts-ignore This is fine
Promise.withResolvers || (Promise.withResolvers = function withResolvers() {
  let a, b;
  const c = new this(function (resolve, reject) {
    a = resolve;
    b = reject;
  });
  return { resolve: a, reject: b, promise: c };
});
