// Side effect imports
import { initLogger } from "../lib/logger.ts";
import { ProxyRouter } from "./service_worker/proxy.ts";
import { MessageHandler } from "./service_worker/message.ts";
import type { SyncEngine } from "./service_worker/sync.ts";
import type { ServiceWorkerMessage } from "./ui_types.ts";

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

let proxyRouter: ProxyRouter | undefined;

new MessageHandler(
  self,
  baseURI,
  basePathName,
  (syncEngine: SyncEngine) => {
    // Ok, we're configured, let's get this thing goin'
    proxyRouter = new ProxyRouter(
      syncEngine.local,
      syncEngine,
      basePathName,
      baseURI,
      precacheFiles,
    );
    // Let's wire up some events
    proxyRouter.on({
      fileWritten: (path) => {
        console.log("File written", path, "requesting sync");
        syncEngine.syncSingleFile(path);
      },
      fileMetaRequested: (path) => {
        console.log("File meta requested", path);
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
  },
);

function broadcastMessage(message: ServiceWorkerMessage) {
  // @ts-ignore: service worker API
  const clients: any = self.clients;
  // Find all windows attached to this service worker
  clients.matchAll({
    type: "window",
  }).then((clients: any[]) => {
    clients.forEach((client) => {
      client.postMessage(message);
    });
  });
}

self.addEventListener("fetch", (event: any) => {
  if (proxyRouter) {
    proxyRouter.handleFetch(event);
  } else {
    event.respondWith(fetch(event.request));
  }
});

initLogger("[Service Worker]");
