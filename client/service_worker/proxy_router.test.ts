import { expect, test } from "vitest";
import {
  belongsToAnotherSpace,
  belongsToSiblingSpace,
  scopedSiblingPrefixes,
} from "./proxy_router.ts";

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
  "/notes/.events",
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
  "/.events",
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

// `belongsToAnotherSpace` only recognizes *space surfaces* one level down
// (`/x/.client/...`). A bare sibling root like `/private/` matches nothing
// there, so while the worker believed it was offline such a navigation fell
// through to the root space's cached shell. The worker now also consults the
// origin's space prefixes, delivered via `BootConfig.spacePrefixes`.

test("the root worker treats every other prefix space as a sibling", () => {
  expect(scopedSiblingPrefixes("", ["/private", "/work"])).toEqual([
    "/private",
    "/work",
  ]);
});

test("a prefix-bound worker only scopes prefixes nested under its own base", () => {
  // Its own prefix is not a sibling, and prefixes outside its scope are
  // unreachable through it. A nested space is kept, space-relative.
  expect(
    scopedSiblingPrefixes("/work", ["/private", "/work", "/work/sub"]),
  ).toEqual(["/sub"]);
});

test.each([
  "/private",
  "/private/",
  "/private/some/page",
])("%s belongs to a sibling space", (path) => {
  expect(belongsToSiblingSpace(path, ["/private"])).toBe(true);
});

test.each([
  // Boundary: a page merely sharing the prefix's characters.
  "/privateer",
  "/",
  "/index",
  "/some/page",
])("%s is not a sibling space path", (path) => {
  expect(belongsToSiblingSpace(path, ["/private"])).toBe(false);
});

test("no known prefixes means nothing is a sibling", () => {
  expect(belongsToSiblingSpace("/private/", [])).toBe(false);
});
