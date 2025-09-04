import { initLogger } from "../lib/logger.ts";
import { ProxyRouter } from "./service_worker/proxy_router.ts";
import { SyncEngine } from "./service_worker/sync_engine.ts";
import type {
  ServiceWorkerSourceMessage,
  ServiceWorkerTargetMessage,
} from "./ui_types.ts";
import { simpleHash } from "../lib/crypto.ts";
import { DataStore } from "../lib/data/datastore.ts";
import { IndexedDBKvPrimitives } from "../lib/data/indexeddb_kv_primitives.ts";
import { fsEndpoint } from "../lib/spaces/constants.ts";
import { DataStoreSpacePrimitives } from "../lib/spaces/datastore_space_primitives.ts";
import { HttpSpacePrimitives } from "../lib/spaces/http_space_primitives.ts";

initLogger("[Service Worker]");

// Note: the only thing cached here is SilverBullet client assets, files are kept in IndexedDB
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

// Initially set to undefined, resulting in all "fetch" being proxied.
// Once the service worker is configured, this will be set and the proxy will handle fetches.
let proxyRouter: ProxyRouter | undefined;

// Message received from client
self.addEventListener("message", async (event: any) => {
  const message: ServiceWorkerTargetMessage = event.data;
  switch (message.type) {
    case "skipWaiting": {
      // @ts-ignore: Skip waiting to activate this service worker immediately
      self.skipWaiting();
      break;
    }
    case "flushCache": {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log("Removing cache", cacheName);
            return caches.delete(cacheName);
          }
        }),
      );
      broadcastMessage({
        type: "cacheFlushed",
      });
      break;
    }
    case "wipeData": {
      if (proxyRouter) {
        await proxyRouter.syncEngine.wipe();
      }
      broadcastMessage({
        type: "dataWiped",
      });
      break;
    }
    case "config": {
      // Configure the service worker if it hasn't been already
      if (proxyRouter) {
        console.info("Service worker already configured");
        return;
      }
      const config = message.config;
      const spaceFolderPath = config.spaceFolderPath;
      // We're generating a simple hashed database name based on the space path in case people regularly switch between multiple space paths
      const spaceHash = "" +
        simpleHash(`${spaceFolderPath}:${baseURI.replace(/\/*$/, "")}`);
      // And we'll use a _files postfix to signify where synced files are kept
      const dbName = `${spaceHash}_files`;

      // Setup KV (database) for store synced files
      const kv = new IndexedDBKvPrimitives(dbName);
      await kv.init();

      // Then wrap that in a DataStore
      const ds = new DataStore(kv);
      // And use that to power the IndexedDB backed local storage
      const local = new DataStoreSpacePrimitives(ds);

      // Which we'll sync with the remote server
      const remote = new HttpSpacePrimitives(
        basePathName + fsEndpoint,
        spaceFolderPath,
        (message, actionOrRedirectHeader) => {
          // And auth error occured
          console.error(
            "[service proxy error]",
            message,
            actionOrRedirectHeader,
          );
          broadcastMessage({
            type: "auth-error",
            message,
            actionOrRedirectHeader,
          });
        },
      );

      // Now let's setup sync
      const syncEngine = new SyncEngine(ds, local, remote);
      await syncEngine.start();

      // Ok, we're ready to go, let's plug in the proxy router
      proxyRouter = new ProxyRouter(
        syncEngine.local,
        syncEngine,
        basePathName,
        baseURI,
        precacheFiles,
      );

      // And wire up some events
      proxyRouter.on({
        fileWritten: (path) => {
          console.log("File written", path, "requesting sync");
          syncEngine.syncSingleFile(path);
        },
        observedRequest: (path) => {
          console.log("Observed request", path);
          syncEngine.syncSingleFile(path);
        },
        onlineStatusChanged: (isOnline) => {
          broadcastMessage({
            type: "online-status",
            isOnline,
          });
        },
      });
      syncEngine.on({
        syncProgress: (status) => {
          broadcastMessage({
            type: "sync-status",
            status,
          });
        },
        syncConflict: (path) => {
          console.warn("Sync conflict detected:", path);
          broadcastMessage({
            type: "sync-conflict",
            path,
          });
        },
        spaceSyncComplete: (operations) => {
          console.log("Space sync complete:", operations);
          broadcastMessage({
            type: "sync-complete",
            operations,
          });
        },
      });
      break;
    }
  }
});

function broadcastMessage(message: ServiceWorkerSourceMessage) {
  // @ts-ignore: service worker API
  const clients: any = self.clients;
  // Find all windows attached to this service worker
  clients.matchAll({
    type: "window",
  }).then((clients: any[]) => {
    clients.forEach((client) => {
      client.postMessage(message);
    });
    if (clients.length === 0) {
      console.info(
        "No clients are listening for messages, dropping message",
        message,
      );
    }
  });
}

self.addEventListener("fetch", (event: any) => {
  if (proxyRouter) {
    // If the proxy router has been setup, relay messages to it
    proxyRouter.onFetch(event);
  } else {
    // Otherwise, just fetch the request normally
    event.respondWith(fetch(event.request));
  }
});

// Service worker lifecycle management
self.addEventListener("install", (event: any) => {
  console.log("Installing service worker...");
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      console.log(
        "Now pre-caching client files",
      );
      await cache.addAll(Object.values(precacheFiles));
      console.log(
        Object.keys(precacheFiles).length,
        "client files cached",
      );
      // @ts-ignore: Force the waiting service worker to become the active service worker
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event: any) => {
  console.log("Activating new service worker!");
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log("Removing old cache", cacheName);
            return caches.delete(cacheName);
          }
        }),
      );
      // @ts-ignore: Take control of all clients as soon as the service worker activates
      await clients.claim();
    })(),
  );
});
