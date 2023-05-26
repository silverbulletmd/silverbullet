import Dexie from "https://esm.sh/v120/dexie@3.2.2/dist/dexie.js";
import { mime } from "https://deno.land/x/mimetypes@v1.0.0/mod.ts";

import type { FileContent } from "../common/spaces/indexeddb_space_primitives.ts";
import { simpleHash } from "../common/crypto.ts";

const CACHE_NAME = "{{CACHE_NAME}}";

const precacheFiles = Object.fromEntries([
  "/",
  "/.client/reset.html",
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
  console.log("[Service worker]", "Activating new service worker!!!");
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log("[Service worker]", "Removing old cache", cacheName);
            return caches.delete(cacheName);
          }
        }),
      ).then(() => {
        // Let's activate ourselves for all existing clients
        // @ts-ignore: No need to wait, clients is a serviceworker thing
        return clients.claim();
      });
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
    // Try the static (client) file cache first
    caches.match(cacheKey)
      .then((response) => {
        // Return the cached response if found
        if (response) {
          return response;
        }

        const requestUrl = new URL(event.request.url);
        const pathname = requestUrl.pathname;
        // If this is a /.fs request, this can either be a plug worker load or an attachment load
        if (pathname.startsWith("/.fs")) {
          if (fileContentTable && !event.request.headers.has("x-sync-mode")) {
            console.log(
              "Attempting to serve file from locally synced space:",
              pathname,
            );
            // Don't fetch from DB when in sync mode (because then updates won't sync)
            const path = decodeURIComponent(
              requestUrl.pathname.slice("/.fs/".length),
            );
            return fileContentTable.get(path).then(
              (data) => {
                if (data) {
                  console.log("Serving from space", path);
                  return new Response(data.data, {
                    headers: {
                      "Content-type": mime.getType(path) ||
                        "application/octet-stream",
                    },
                  });
                } else {
                  console.error(
                    "Did not find file in locally synced space",
                    path,
                  );
                  return new Response("Not found", {
                    status: 404,
                  });
                }
              },
            );
          } else {
            // Just fetch the file directly
            return fetch(event.request);
          }
        } else if (pathname !== "/.auth") {
          // Must be a page URL, let's serve index.html which will handle it
          return caches.match(precacheFiles["/"]).then((response) => {
            // This shouldnt't happen, index.html not in the cache for some reason
            return response || fetch(event.request);
          });
        } else {
          return fetch(event.request);
        }
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
