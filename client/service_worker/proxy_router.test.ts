import { expect, test } from "vitest";
import { belongsToAnotherSpace } from "./proxy_router.ts";

// A space bound at "/" registers its service worker at scope "/", so it
// receives requests for every *other* space on the origin too. Answering those
// from its own precache or local data is how `/notes/.client/auth.js` came
// back as the SPA shell — HTML where a JavaScript module was expected, leaving
// the login page blank.
//
// Paths here are already space-relative (basePathName stripped), so for the
// root worker they are the full path.

test.each([
  "/notes/.client/auth.js",
  "/notes/.client/client.js",
  "/notes/.auth",
  "/notes/.fs/index.md",
  "/notes/.config",
  "/deeply/nested/prefix/.client/app.css",
])("%s belongs to another space", (path) => {
  expect(belongsToAnotherSpace(path)).toBe(true);
});

test.each([
  // Our own surfaces sit directly under our base.
  "/.client/client.js",
  "/.auth",
  "/.fs/index.md",
  "/.config",
  // Ordinary pages, including ones that merely look like a prefix.
  "/",
  "/index",
  "/some/page",
  "/notes/subpage",
  // A page whose name starts with a dot but is not a known surface.
  "/notes/.hidden",
  // A dotted segment at the root that is not a server surface either.
  "/.something-else",
])("%s is ours to handle", (path) => {
  expect(belongsToAnotherSpace(path)).toBe(false);
});

test("a page named like a surface, one level down, is still another space", () => {
  // `/x/.fs` is unambiguous: no space serves a page called ".fs".
  expect(belongsToAnotherSpace("/x/.fs")).toBe(true);
});
