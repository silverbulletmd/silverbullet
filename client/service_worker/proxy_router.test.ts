import { expect, test } from "vitest";
import {
  belongsToAnotherSpace,
  belongsToSiblingSpace,
  isInitialSyncLocalReadCandidate,
  ProxyRouter,
  scopedSiblingPrefixes,
} from "./proxy_router.ts";

function routerWithFile(
  contentType: string,
  data: Uint8Array = new Uint8Array([1, 2, 3]),
): ProxyRouter {
  const router = new ProxyRouter("", "http://localhost/", {});
  router.localSpacePrimitives = {
    readFile: async () => ({
      meta: {
        name: "note.html",
        contentType,
        size: data.byteLength,
        created: 0,
        lastModified: 0,
        perm: "rw",
      },
      data,
    }),
  } as any;
  router.syncEngine = {} as any;
  return router;
}

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

const syncModeHeaders = new Headers({ "X-Sync-Mode": "true" });

test.each([
  "/.fs/index.md",
  "/.fs/Library/Std/Config.md",
  "/.fs/attachment.png",
])("initial sync: programmatic GET of %s may be served locally", (path) => {
  expect(isInitialSyncLocalReadCandidate("GET", path, syncModeHeaders)).toBe(
    true,
  );
});

test("initial sync: the file listing is never served locally", () => {
  expect(isInitialSyncLocalReadCandidate("GET", "/.fs", syncModeHeaders)).toBe(
    false,
  );
  expect(isInitialSyncLocalReadCandidate("GET", "/.fs/", syncModeHeaders)).toBe(
    false,
  );
});

test("initial sync: writes and deletes are never served locally", () => {
  expect(
    isInitialSyncLocalReadCandidate("PUT", "/.fs/index.md", syncModeHeaders),
  ).toBe(false);
  expect(
    isInitialSyncLocalReadCandidate("DELETE", "/.fs/index.md", syncModeHeaders),
  ).toBe(false);
});

test("initial sync: markdown navigations (no X-Sync-Mode) keep proxy-first behavior", () => {
  expect(
    isInitialSyncLocalReadCandidate("GET", "/.fs/index.md", new Headers()),
  ).toBe(false);
});

// Plug worker scripts and attachments are fetched by the browser itself
// (worker boot, <img>), which sets no X-Sync-Mode header. Those must be
// local-read candidates too: on a slow link, proxying an already-synced
// .plug.js can push the worker boot past its 5s creation timeout — plugs sync
// first precisely so their files are available early.
test.each([
  "/.fs/Library/Std/Plugs/index.plug.js",
  "/.fs/photo.png",
])("initial sync: non-markdown GET of %s may be served locally without the header", (path) => {
  expect(isInitialSyncLocalReadCandidate("GET", path, new Headers())).toBe(
    true,
  );
});

test("initial sync: non-fs paths are not local-read candidates", () => {
  expect(
    isInitialSyncLocalReadCandidate("GET", "/index", syncModeHeaders),
  ).toBe(false);
  expect(
    isInitialSyncLocalReadCandidate("GET", "/.config", syncModeHeaders),
  ).toBe(false);
});

test("serves html from cache as a forced download", async () => {
  const router = routerWithFile("text/html");
  const resp = await router.handleGet(
    "note.html",
    new Request("http://localhost/.fs/note.html"),
  );
  expect(resp.headers.get("Content-Disposition")).toBe("attachment");
  expect(resp.headers.get("X-Content-Type-Options")).toBe("nosniff");
});

test("serves images inline (no download header)", async () => {
  const router = routerWithFile("image/png");
  const resp = await router.handleGet(
    "photo.png",
    new Request("http://localhost/.fs/photo.png"),
  );
  expect(resp.headers.get("Content-Disposition")).toBeNull();
  expect(resp.headers.get("X-Content-Type-Options")).toBeNull();
});

async function onFetchLocalRead(
  router: ProxyRouter,
  path: string,
): Promise<Response> {
  const originalCaches = (globalThis as any).caches;
  (globalThis as any).caches = { match: async () => undefined };
  try {
    let responsePromise: Promise<Response> | undefined;
    const event = {
      request: new Request(`http://localhost/.fs/${path}`),
      respondWith: (p: Promise<Response>) => {
        responsePromise = p;
      },
    };
    router.onFetch(event);
    return await responsePromise!;
  } finally {
    (globalThis as any).caches = originalCaches;
  }
}

test("onFetch initial-sync fast path forces html to download", async () => {
  const router = routerWithFile("text/html");
  const resp = await onFetchLocalRead(router, "evil.html");
  expect(resp.headers.get("Content-Disposition")).toBe("attachment");
  expect(resp.headers.get("X-Content-Type-Options")).toBe("nosniff");
});

test("onFetch initial-sync fast path serves images inline (no download header)", async () => {
  const router = routerWithFile("image/png");
  const resp = await onFetchLocalRead(router, "photo.png");
  expect(resp.headers.get("Content-Disposition")).toBeNull();
  expect(resp.headers.get("X-Content-Type-Options")).toBeNull();
});
