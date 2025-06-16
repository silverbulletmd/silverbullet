import type { FileContent } from "../lib/spaces/datastore_space_primitives.ts";
import { simpleHash } from "../lib/crypto.ts";
import { DataStore } from "../lib/data/datastore.ts";
import { IndexedDBKvPrimitives } from "../lib/data/indexeddb_kv_primitives.ts";
import {
  decodePageURI,
  looksLikePathWithExtension,
} from "@silverbulletmd/silverbullet/lib/page_ref";

// Note: the only thing cached here is SilverBullet client assets, files and databases are kept in IndexedDB
const CACHE_NAME = "{{CACHE_NAME}}";

//`location.href` minus this worker's filename will be our base URL, including any URL prefix
//(-1 is to remove the trailing '/')
const workerFilename = location.pathname.substring(
  location.pathname.lastIndexOf("/") + 1,
);
const baseURI = location.href.substring(
  0,
  location.href.length - workerFilename.length - 1,
);
const basePathName = location.pathname.substring(
  0,
  location.pathname.length - workerFilename.length - 1,
);
console.log(
  `[Service Worker] Established baseURI=[${baseURI}]; basePathName=[${basePathName}]`,
);

const precacheFiles = Object.fromEntries([
  "/",
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
].map((path) => [path, `${baseURI}${path}?v=${CACHE_NAME}`, path])); // Cache busting

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
      // @ts-ignore: Force the waiting service worker to become the active service worker
      await self.skipWaiting();
      console.log("[Service worker]", "skipWaiting complete");
    })(),
  );
});

self.addEventListener("activate", (event: any) => {
  console.log("[Service worker]", "Activating new service worker!");
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
      // @ts-ignore: Take control of all clients as soon as the service worker activates
      await clients.claim();
    })(),
  );
});

let ds: DataStore | undefined;
const filesContentPrefix = ["file", "content"];

self.addEventListener("fetch", (event: any) => {
  const url = new URL(event.request.url);

  const pathname = url.pathname.substring(basePathName.length); //url.pathname with any URL prefix removed

  // Use the custom cache key if available, otherwise use the request URL
  const cacheKey = precacheFiles[pathname] || event.request.url;

  event.respondWith(
    (async () => {
      const request = event.request;
      const requestUrl = new URL(request.url);

      // Are we fetching a URL from the same origin as the app? If not, we don't handle it and pass it on
      if (!requestUrl.href.startsWith(baseURI)) {
        return fetch(request);
      }

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

      if (!ds) {
        // Not initialzed yet
        return fetch(request);
      }

      const pathname = requestUrl.pathname.substring(basePathName.length); //requestUrl.pathname without with any URL prefix removed

      if (
        pathname === "/.auth" ||
        pathname === "/.logout" ||
        pathname === "/.config" ||
        pathname === "/index.json"
      ) {
        return fetch(request);
      } else if (
        pathname.endsWith(".md") &&
        request.headers.get("accept") !== "application/octet-stream" &&
        request.headers.get("sec-fetch-mode") !== "cors"
      ) {
        return Response.redirect(`${pathname.slice(0, -3)}`);
      } else if (
        (looksLikePathWithExtension(pathname) &&
          !request.headers.get("accept").includes("text/html")) ||
        requestUrl.searchParams.get("raw") === "true"
      ) {
        // If this is a /*.* request, this can either be a plug worker load or an document load
        return handleLocalFileRequest(pathname, request);
      } else {
        // Must be a page URL, let's serve index.html which will handle it
        return (await caches.match(precacheFiles["/"])) || fetch(request);
      }
    })().catch((e) => {
      console.warn("[Service worker]", "Fetch failed:", e);
      return new Response("Offline", {
        status: 503, // Service Unavailable
      });
    }),
  );
});

async function handleLocalFileRequest(
  pathname: string,
  request: Request,
): Promise<Response> {
  const path = decodePageURI(pathname.slice(1));
  const data = await ds?.get<FileContent>([...filesContentPrefix, path]);
  if (data) {
    // console.log("Serving from space", path);
    return new Response(
      data.data,
      {
        headers: {
          "Content-type": data.meta.contentType,
          "Content-Length": "" + data.meta.size,
          "X-Permission": data.meta.perm,
          "X-Created": "" + data.meta.created,
          "X-Last-Modified": "" + data.meta.lastModified,
        },
      },
    );
  } else {
    console.warn(
      "Did not find file in locally synced space",
      path,
    );
    // If this is a _plug request and we don't have it, we may not have performed an initial sync yet
    if (path.startsWith("_plug/")) {
      console.info("Proxying _plug fetch to server", path);
      return fetch(request);
    }

    return new Response("Not found", {
      status: 404,
      headers: {
        "Cache-Control": "no-cache",
      },
    });
  }
}

self.addEventListener("message", (event: any) => {
  switch (event.data.type) {
    case "skipWaiting": {
      console.log(
        "[Service worker]",
        "Received skipWaiting message, activating immediately",
      );
      // @ts-ignore: Skip waiting to activate this service worker immediately
      self.skipWaiting();
      break;
    }
    case "config": {
      const spaceFolderPath = event.data.config.spaceFolderPath;
      const dbPrefix = "" +
        simpleHash(`${spaceFolderPath}:${baseURI.replace(/\/*$/, "")}`);

      // Setup space
      const kv = new IndexedDBKvPrimitives(dbPrefix);
      kv.init().then(() => {
        ds = new DataStore(kv);
        console.log("Datastore in service worker initialized...");
      });
      break;
    }
  }
});
