import { notFoundError } from "@silverbulletmd/silverbullet/constants";
import { expect, test, vi } from "vitest";
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

test("reset releases storage and sync references without deleting local files", async () => {
  const router = routerWithFile(
    "text/plain",
    new TextEncoder().encode("Saved draft"),
  );
  const storage = router.localSpacePrimitives!;
  let stopped = false;
  router.syncEngine = {
    stop() {
      stopped = true;
    },
  } as any;
  router.reset();
  expect(stopped).toBe(true);
  expect(router.localSpacePrimitives).toBeUndefined();
  expect(router.syncEngine).toBeUndefined();
  expect(
    new TextDecoder().decode((await storage.readFile("Draft.md")).data),
  ).toBe("Saved draft");
});

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

// Bare sibling roots do not match space surfaces; BootConfig.spacePrefixes
// must keep offline navigation from serving the wrong space's shell.

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

test("serves html from cache inline", async () => {
  const router = routerWithFile("text/html");
  const resp = await router.handleGet(
    "note.html",
    new Request("http://localhost/.fs/note.html"),
  );
  expect(resp.headers.get("Content-Disposition")).toBeNull();
  expect(resp.headers.get("X-Content-Type-Options")).toBeNull();
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
  init?: RequestInit,
): Promise<Response> {
  const originalCaches = (globalThis as any).caches;
  (globalThis as any).caches = { match: async () => undefined };
  try {
    let responsePromise: Promise<Response> | undefined;
    const event = {
      request: new Request(`http://localhost/.fs/${path}`, init),
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

test("onFetch initial-sync fast path serves html inline", async () => {
  const router = routerWithFile("text/html");
  const resp = await onFetchLocalRead(router, "evil.html");
  expect(resp.headers.get("Content-Disposition")).toBeNull();
  expect(resp.headers.get("X-Content-Type-Options")).toBeNull();
});

test("onFetch initial-sync fast path serves images inline (no download header)", async () => {
  const router = routerWithFile("image/png");
  const resp = await onFetchLocalRead(router, "photo.png");
  expect(resp.headers.get("Content-Disposition")).toBeNull();
  expect(resp.headers.get("X-Content-Type-Options")).toBeNull();
});

test("handleGet serves a local byte range", async () => {
  const router = routerWithFile(
    "video/mp4",
    new TextEncoder().encode("0123456789"),
  );
  const response = await router.handleGet(
    "clip.bin",
    new Request("http://localhost/.fs/clip.bin", {
      headers: { Range: "bytes=2-5" },
    }),
  );

  expect(response.status).toBe(206);
  expect(response.headers.get("Content-Range")).toBe("bytes 2-5/10");
  expect(await response.text()).toBe("2345");
});

test("the initial-sync local fast path serves a byte range", async () => {
  const router = routerWithFile(
    "video/mp4",
    new TextEncoder().encode("0123456789"),
  );
  const response = await onFetchLocalRead(router, "clip.bin", {
    headers: { Range: "bytes=2-5" },
  });

  expect(response.status).toBe(206);
  expect(response.headers.get("Content-Range")).toBe("bytes 2-5/10");
  expect(await response.text()).toBe("2345");
});

test("the initial-sync local fast path serves HEAD without a network request", async () => {
  const router = routerWithFile(
    "video/mp4",
    new TextEncoder().encode("0123456789"),
  );
  const originalFetch = globalThis.fetch;
  const fetchMock = vi.fn(
    async (_request: RequestInfo | URL) => new Response(null, { status: 502 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  try {
    const response = await onFetchLocalRead(router, "clip.bin", {
      method: "HEAD",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Length")).toBe("10");
    expect(response.headers.get("X-Content-Length")).toBe("10");
    expect(response.headers.get("Accept-Ranges")).toBe("bytes");
    expect((await response.arrayBuffer()).byteLength).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  } finally {
    vi.stubGlobal("fetch", originalFetch);
  }
});

test("HEAD is served from local storage without a body", async () => {
  const router = routerWithFile(
    "video/mp4",
    new TextEncoder().encode("0123456789"),
  );
  const originalFetch = globalThis.fetch;
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  try {
    const response = await router.handleRequest(
      "/.fs/clip.bin",
      new Request("http://localhost/.fs/clip.bin", { method: "HEAD" }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Length")).toBe("10");
    expect((await response.arrayBuffer()).byteLength).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  } finally {
    vi.stubGlobal("fetch", originalFetch);
  }
});

test("a missing local file proxies the original range request untouched", async () => {
  const router = routerWithFile("video/mp4");
  router.localSpacePrimitives = {
    readFile: async () => {
      throw new Error(notFoundError.message);
    },
  } as any;
  const request = new Request("http://localhost/.fs/remote.mp4", {
    headers: {
      Range: "bytes=4-7",
      "If-Range": "Wed, 21 Oct 2015 07:28:00 GMT",
    },
  });
  const upstream = new Response("4567", {
    status: 206,
    headers: { "Content-Range": "bytes 4-7/10" },
  });
  const originalFetch = globalThis.fetch;
  const fetchMock = vi.fn(async (_request: RequestInfo | URL) => upstream);
  vi.stubGlobal("fetch", fetchMock);
  try {
    const response = await router.handleGet("remote.mp4", request);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]![0]).toBe(request);
    const proxiedRequest = fetchMock.mock.calls[0]![0] as Request;
    expect(proxiedRequest.headers.get("Range")).toBe("bytes=4-7");
    expect(proxiedRequest.headers.get("If-Range")).toBe(
      "Wed, 21 Oct 2015 07:28:00 GMT",
    );
    expect(response).toBe(upstream);
    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe("bytes 4-7/10");
    expect(await response.text()).toBe("4567");
  } finally {
    vi.stubGlobal("fetch", originalFetch);
  }
});

test("a local cheap metadata probe reads metadata without reading the body", async () => {
  const router = routerWithFile("video/mp4");
  const getFileMeta = vi.fn(async () => ({
    name: "clip.mp4",
    contentType: "video/mp4",
    size: 10,
    created: 0,
    lastModified: 0,
    perm: "rw",
  }));
  const readFile = vi.fn(async () => {
    throw new Error("body must not be read");
  });
  router.localSpacePrimitives = { getFileMeta, readFile } as any;
  const response = await router.handleGet(
    "clip.mp4",
    new Request("http://localhost/.fs/clip.mp4", {
      headers: { "X-Get-Meta": "cheap" },
    }),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("X-Content-Length")).toBe("10");
  expect(getFileMeta).toHaveBeenCalledOnce();
  expect(readFile).not.toHaveBeenCalled();
});

test("a missing local cheap metadata probe is proxied with its mode intact", async () => {
  const router = routerWithFile("video/mp4");
  router.localSpacePrimitives = {
    getFileMeta: async () => {
      throw new Error(notFoundError.message);
    },
  } as any;
  const request = new Request("http://localhost/.fs/remote.mp4", {
    headers: { "X-Get-Meta": "cheap", "X-Observing": "true" },
  });
  const upstream = new Response(null, { status: 200 });
  const originalFetch = globalThis.fetch;
  const fetchMock = vi.fn(async (_request: RequestInfo | URL) => upstream);
  vi.stubGlobal("fetch", fetchMock);
  try {
    expect(await router.handleGet("remote.mp4", request)).toBe(upstream);
    expect(fetchMock).toHaveBeenCalledWith(request);
    const proxied = fetchMock.mock.calls[0][0] as Request;
    expect(proxied.headers.get("X-Get-Meta")).toBe("cheap");
    expect(proxied.headers.get("X-Observing")).toBe("true");
  } finally {
    vi.stubGlobal("fetch", originalFetch);
  }
});
