import Dexie, {} from "https://esm.sh/v120/dexie@3.2.2/dist/dexie.js";
import { simpleHash } from "../common/crypto.ts";
import type { FileContent } from "../common/spaces/indexeddb_space_primitives.ts";
import { plugPrefix } from "../common/spaces/constants.ts";

const CACHE_NAME = "{{CACHE_NAME}}";

const precacheFiles = Object.fromEntries([
  "/",
  "/auth.html",
  "/reset.html",
  "/client.js",
  "/favicon.png",
  "/iAWriterMonoS-Bold.woff2",
  "/iAWriterMonoS-BoldItalic.woff2",
  "/iAWriterMonoS-Italic.woff2",
  "/iAWriterMonoS-Regular.woff2",
  "/logo.png",
  "/main.css",
  "/manifest.json",
].map((path) => [path, path + "?v=" + Date.now(), path]));

self.addEventListener("install", (event: any) => {
  console.log("[Service worker]", "Installing service worker...");
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log(
          "[Service worker]",
          "Now pre-caching client files",
        );
        return cache.addAll(Object.values(precacheFiles)).then(() => {
          console.log(
            "[Service worker]",
            Object.keys(precacheFiles).length,
            "client files cached",
          );
          // @ts-ignore: No need to wait
          self.skipWaiting();
        });
      }),
  );
});

self.addEventListener("activate", (event: any) => {
  console.log("[Service worker]", "Activating new service worker");
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log("[Service worker]", "Removing old cache", cacheName);
            return caches.delete(cacheName);
          }
        }),
      );
    }),
  );
});

let db: Dexie | undefined;
let fileContentTable: Dexie.Table<FileContent, string> | undefined;

self.addEventListener("fetch", (event: any) => {
  const url = new URL(event.request.url);

  // Use the custom cache key if available, otherwise use the request URL
  const cacheKey = precacheFiles[url.pathname] || event.request.url;

  event.respondWith(
    caches.match(cacheKey)
      .then((response) => {
        // Return the cached response if found
        if (response) {
          return response;
        }

        const requestUrl = new URL(event.request.url);
        const pathname = requestUrl.pathname;
        if (pathname.startsWith(`/fs/${plugPrefix}`)) {
          // console.log(
          //   "Service plug code from space:",
          //   pathname,
          //   [...event.request.headers.keys()],
          // );
          if (fileContentTable && !event.request.headers.has("x-sync-mode")) {
            // Don't fetch from DB when in sync mode (because then updates plugs won't sync)
            const plugPath = requestUrl.pathname.slice("/fs/".length);
            return fileContentTable.get(plugPath).then(
              (data) => {
                if (data) {
                  console.log("Serving from space", plugPath);
                  const src = new TextDecoder().decode(data.data);
                  const match = /zef\d+/.exec(src);
                  if (match) {
                    console.log("EXTRACTED THIS", match);
                  }
                  return new Response(data.data, {
                    headers: {
                      "Content-type": plugPath.endsWith(".js")
                        ? "application/javascript"
                        : "application/json",
                    },
                  });
                } else {
                  console.error(
                    "Did not find plug in synced files",
                    plugPath,
                  );
                  return new Response("Not found");
                }
              },
            );
          } else {
            return fetch(event.request);
          }
        }
        if (!requestUrl.pathname.startsWith("/fs")) {
          // Page, let's serve index.html
          return caches.match(precacheFiles["/"]).then((response) => {
            // This shouldnt't happen, index.html not in the cache for some reason
            return response || fetch(event.request);
          });
        }

        return fetch(event.request);
      }),
  );
});

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
  }
});
