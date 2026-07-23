import { afterEach, beforeEach, expect, test } from "vitest";
import { bindingLabel, spaceUrl } from "./bindings.ts";

// `bindingLabel`/`spaceUrl` read the browser `location` global (for the
// listener port on host-bound spaces). Vitest's default "node" environment
// doesn't define it, so stub it the way a `test.localhost:3000` admin page
// would see it.
beforeEach(() => {
  // deno-lint-ignore no-explicit-any
  (globalThis as any).location = { port: "3000" };
});

afterEach(() => {
  // deno-lint-ignore no-explicit-any
  delete (globalThis as any).location;
});

test('spaceUrl normalizes a bare-root prefix of "" to "/"', () => {
  expect(spaceUrl({ prefix: "" })).toBe("/");
});

test('spaceUrl normalizes a literal "/" prefix to "/", not "//"', () => {
  // Regression test for Fix 3: server/src/multi/validate.rs accepts a bare
  // "/" prefix and never normalizes it before persisting, so a stored
  // binding can have `prefix === "/"` exactly. `${prefix}/` used to turn
  // that into "//" -- a protocol-relative URL with an empty authority that
  // navigates nowhere useful, and this sits on SpaceList, the landing
  // screen for every ordinary account.
  expect(spaceUrl({ prefix: "/" })).toBe("/");
});

test("spaceUrl appends a trailing slash to a normal prefix", () => {
  expect(spaceUrl({ prefix: "/foo" })).toBe("/foo/");
});

test("spaceUrl doesn't double up a prefix that already ends in a slash", () => {
  expect(spaceUrl({ prefix: "/foo/" })).toBe("/foo/");
});

test("spaceUrl for a host binding ignores the prefix and uses the listener port", () => {
  expect(spaceUrl({ host: "test.localhost" })).toBe("//test.localhost:3000/");
});

test('bindingLabel shows a bare-root prefix as "/"', () => {
  expect(bindingLabel({ prefix: "" })).toBe("/");
  expect(bindingLabel({ prefix: "/" })).toBe("/");
});

test("bindingLabel shows a host binding with its listener port", () => {
  expect(bindingLabel({ host: "test.localhost" })).toBe("test.localhost:3000");
});
