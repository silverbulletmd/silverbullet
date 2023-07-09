import Dexie from "https://esm.sh/v120/dexie@3.2.2/dist/dexie.js";

import type { FileContent } from "../common/spaces/indexeddb_space_primitives.ts";
import { simpleHash } from "../common/crypto.ts";
import type { FileMeta } from "../common/types.ts";

const CACHE_NAME = "{{CACHE_NAME}}";

const precacheFiles = Object.fromEntries([
  "/",
  "/.client/logout.html",
  "/.client/client.js",
  "/.client/favicon.png",
  "/.client/iAWriterMonoS-Bold.woff2",
  "/.client/iAWriterMonoS-BoldItalic.woff2",
  "/.client/iAWriterMonoS-Italic.woff2",
  "/.client/iAWriterMonoS-Regular.woff2",
  "/.client/logo.png",
  "/.client/logo-dock.png",
  "/.client/main.css",
  "/.client/manifest.json",
].map((path) => [path, path + "?v=" + CACHE_NAME, path])); // Cache busting

self.addEventListener("install", (event: any) => {
  console.log("[Service worker]", "Installing service worker...");
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      console.log(
        "[Service worker]",
        "Now pre-caching client files",
      );
      await cache.addAll(Object.values(precacheFiles));
      console.log(
        "[Service worker]",
        Object.keys(precacheFiles).length,
        "client files cached",
      );
      // @ts-ignore: No need to wait
      self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event: any) => {
  console.log("[Service worker]", "Activating new service worker!!!");
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log("[Service worker]", "Removing old cache", cacheName);
            return caches.delete(cacheName);
          }
        }),
      );
      // @ts-ignore: No need to wait
      return clients.claim();
    })(),
  );
});

let db: Dexie | undefined;
let fileContentTable: Dexie.Table<FileContent, string> | undefined;
let fileMetatable: Dexie.Table<FileMeta, string> | undefined;

self.addEventListener("fetch", (event: any) => {
  const url = new URL(event.request.url);

  // Use the custom cache key if available, otherwise use the request URL
  const cacheKey = precacheFiles[url.pathname] || event.request.url;

  event.respondWith(
    (async () => {
      const request = event.request;

      // console.log("Getting request", request, [...request.headers.entries()]);

      // Any request with the X-Sync-Mode header originates from the sync engine: pass it on to the server
      if (request.headers.has("x-sync-mode")) {
        return fetch(request);
      }

      // Try the static (client) file cache first
      const cachedResponse = await caches.match(cacheKey);
      // Return the cached response if found
      if (cachedResponse) {
        return cachedResponse;
      }

      const requestUrl = new URL(request.url);
      const pathname = requestUrl.pathname;

      // Are we fetching a URL from the same origin as the app? If not, we don't handle it and pass it on
      if (location.host !== requestUrl.host) {
        return fetch(request);
      }

      if (pathname === "/.auth" || pathname === "/index.json") {
        return fetch(request);
      } else if (/\/.+\.[a-zA-Z]+$/.test(pathname)) {
        // If this is a /*.* request, this can either be a plug worker load or an attachment load
        return handleLocalFileRequest(request, pathname);
      } else {
        // Must be a page URL, let's serve index.html which will handle it
        return (await caches.match(precacheFiles["/"])) || fetch(request);
      }
    })(),
  );
});

async function handleLocalFileRequest(
  request: Request,
  pathname: string,
): Promise<Response> {
  if (!fileContentTable) {
    // Not initialzed yet, or explicitly in sync mode (so direct server communication requested)
    return fetch(request);
  }

  if (!db?.isOpen()) {
    console.log("Detected that the DB was closed, reopening");
    await db!.open();
  }
  const path = decodeURIComponent(pathname.slice(1));
  const data = await fileContentTable.get(path);
  if (data) {
    // console.log("Serving from space", path);
    if (!data.meta) {
      // Legacy database not fully synced yet
      data.meta = (await fileMetatable!.get(path))!;
    }
    return new Response(
      data.data,
      {
        headers: {
          "Content-type": data.meta.contentType,
          "Content-Length": "" + data.meta.size,
          "X-Permission": data.meta.perm,
          "X-Last-Modified": "" + data.meta.lastModified,
        },
      },
    );
  } else {
    console.error(
      "Did not find file in locally synced space",
      path,
    );
    return new Response("Not found", {
      status: 404,
    });
  }
}

self.addEventListener("message", (event: any) => {
  if (event.data.type === "flushCache") {
    caches.delete(CACHE_NAME)
      .then(() => {
        console.log("[Service worker]", "Cache deleted");
        db?.close();
        event.source.postMessage({ type: "cacheFlushed" });
      });
  }
  if (event.data.type === "config") {
    const spaceFolderPath = event.data.config.spaceFolderPath;
    const dbPrefix = "" + simpleHash(spaceFolderPath);

    // Setup space
    db = new Dexie(`${dbPrefix}_space`, {
      indexedDB: globalThis.indexedDB,
    });
    db.version(1).stores({
      fileMeta: "name",
      fileContent: "name",
    });

    fileContentTable = db.table<FileContent, string>("fileContent");
    fileMetatable = db.table<FileMeta, string>("fileMeta");
  }
});
