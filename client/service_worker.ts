import { initLogger } from "./lib/logger.ts";
import { ProxyRouter } from "./service_worker/proxy_router.ts";

import { SyncEngine } from "./service_worker/sync_engine.ts";
import type {
  ServiceWorkerSourceMessage,
  ServiceWorkerTargetMessage,
} from "./types/ui.ts";
import {
  base64Decode,
  deriveCTRKeyFromPassword,
  simpleHash,
} from "@silverbulletmd/silverbullet/lib/crypto";
import { IndexedDBKvPrimitives } from "./data/indexeddb_kv_primitives.ts";
import { fsEndpoint } from "./spaces/constants.ts";
import { DataStoreSpacePrimitives } from "./spaces/datastore_space_primitives.ts";
import { HttpSpacePrimitives } from "./spaces/http_space_primitives.ts";
import { throttleImmediately } from "@silverbulletmd/silverbullet/lib/async";
import { wrongSpacePathError } from "@silverbulletmd/silverbullet/constants";
import type { KvPrimitives } from "./data/kv_primitives.ts";
import { EncryptedKvPrimitives } from "./data/encrypted_kv_primitives.ts";

const logger = initLogger("[Service Worker]");

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
const proxyRouter = new ProxyRouter(
  basePathName,
  baseURI,
  precacheFiles,
);

// Configuration mutex
let configuring = false;

// @ts-ignore: debugging
globalThis.proxyRouter = proxyRouter;

// This is the in-memory store of an encryption key that SB clients and the index engine can share without asking for it constantly
let encryptionPhraseMemoryStore: string | undefined;

// Let's clean this encryptionKey if there's no more clients left for a little while, asking to re-enter
setInterval(() => {
  // @ts-ignore: service worker API
  globalThis.clients.matchAll().then((clients) => {
    if (clients.length === 0) {
      console.info("No more clients, flushing encryption key");
      encryptionPhraseMemoryStore = undefined;
    }
  });
}, 5000); // little while is 5s

// Message received from client
self.addEventListener("message", async (event: any) => {
  const message: ServiceWorkerTargetMessage = event.data;
  switch (message.type) {
    case "skip-waiting": {
      // @ts-ignore: Skip waiting to activate this service worker immediately
      self.skipWaiting();
      break;
    }
    case "shutdown": {
      proxyRouter.reset();
      break;
    }
    case "flush-cache": {
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
    case "wipe-data": {
      if (proxyRouter.syncEngine) {
        await proxyRouter.syncEngine.wipe();
        broadcastMessage({
          type: "dataWiped",
        });
      } else {
        console.warn("Not performing sync data wipe, sync engine not started");
      }
      break;
    }
    case "perform-file-sync": {
      if (proxyRouter.syncEngine) {
        await proxyRouter.syncEngine.syncSingleFile(
          message.path,
        );
      } else {
        console.warn(
          "Ignoring perform-file-sync request, proxy not configured yet",
        );
      }

      break;
    }
    case "perform-space-sync": {
      if (proxyRouter.syncEngine) {
        await proxyRouter.syncEngine.syncSpace();
      } else {
        console.warn(
          "Ignoring perform-space-sync request, proxy not configured yet",
        );
      }
      break;
    }
    case "force-connection-status": {
      proxyRouter.forcedStatus = message.enabled;
      console.info("Forced connection status to", message.enabled);
      break;
    }
    case "get-encryption-phrase": {
      event.source.postMessage({
        type: "encryption-key",
        key: encryptionPhraseMemoryStore,
      } as ServiceWorkerSourceMessage);
      break;
    }
    case "set-encryption-phrase": {
      encryptionPhraseMemoryStore = message.phrase;
      console.info("Encryption phrase set");
      break;
    }
    case "config": {
      const config = message.config;
      // Configure the service worker if it hasn't been already
      if (isConfigured()) {
        console.info(
          "Service worker already configured, just updating configs",
        );
        proxyRouter.syncEngine!.setSyncConfig({
          syncDocuments: config.syncDocuments,
          syncIgnore: config.syncIgnore,
        });

        return;
      } else {
        console.info("Service being configured with", config);
      }
      if (configuring) {
        console.info("Configuration already in progress, skipping");
        return;
      }
      // Lock configuration mutex
      configuring = true;
      // Put a timeout on it, just in case
      setTimeout(() => {
        configuring = false;
      }, 5000);
      try {
        const spaceFolderPath = config.spaceFolderPath;
        // We're generating a simple hashed database name based on the space path in case people regularly switch between multiple space paths
        const spaceHash = "" +
          simpleHash(`${spaceFolderPath}:${baseURI.replace(/\/*$/, "")}`);
        // And we'll use a _files postfix to signify where synced files are kept
        const dbName = `${spaceHash}_files` +
          (config.encryptionSalt ? "_" + config.encryptionSalt : "");

        if (config.logPush) {
          setInterval(() => {
            logger.postToServer(".logs", "service_worker");
          }, 1000);
        }

        // Setup KV (database) for store synced files
        let kv: KvPrimitives = new IndexedDBKvPrimitives(dbName);
        await (kv as IndexedDBKvPrimitives).init();

        if (config.encryptionSalt) {
          if (!encryptionPhraseMemoryStore) {
            console.error(
              "Supposed to use encryption, but no phrase set yet, auth error",
            );
            broadcastMessage({
              type: "auth-error",
              message: "No encryption phrase set, redirecting to authenticate",
              actionOrRedirectHeader: "reload",
            });
            return;
          } else {
            const key = await deriveCTRKeyFromPassword(
              encryptionPhraseMemoryStore,
              base64Decode(config.encryptionSalt),
            );
            kv = new EncryptedKvPrimitives(kv, key);
            await (kv as EncryptedKvPrimitives).init();
          }
        }

        // And use that to power the IndexedDB backed local storage
        const local = new DataStoreSpacePrimitives(kv);

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
            if (message === wrongSpacePathError.message) {
              proxyRouter.reset();
            }
            broadcastMessage({
              type: "auth-error",
              message,
              actionOrRedirectHeader,
            });
          },
        );

        // Now let's setup sync
        const syncEngine = new SyncEngine(kv, local, remote);
        syncEngine.setSyncConfig({
          syncDocuments: config.syncDocuments,
          syncIgnore: config.syncIgnore,
        });
        await syncEngine.start();

        // Ok, we're ready to go, let's plug in the proxy router
        proxyRouter.configure(syncEngine);

        // And wire up some events
        proxyRouter.on({
          observedRequest: (path) => {
            // This is triggered for the currently open file, we want to proactively sync it to keep it up to date
            syncEngine.syncSingleFile(path);
          },
          onlineStatusUpdated: (isOnline) => {
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
              type: "space-sync-complete",
              operations,
            });
          },
          fileSyncComplete: (path, operations) => {
            broadcastMessage({
              type: "file-sync-complete",
              path,
              operations,
            });
          },
          syncError: (error) => {
            broadcastMessage({
              type: "sync-error",
              message: error.message,
            });
          },
        });
      } finally {
        // Unlock mutex
        configuring = false;
      }
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

const throttledServiceWorkerStarted = throttleImmediately(() => {
  broadcastMessage({
    type: "service-worker-started",
  });
}, 100);

self.addEventListener("fetch", (event: any) => {
  if (!isConfigured()) {
    throttledServiceWorkerStarted();
  }

  // Always delegate to the proxy router
  proxyRouter.onFetch(event);
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

  if (!isConfigured()) {
    throttledServiceWorkerStarted();
  }

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

console.log("Service worker loaded");

function isConfigured() {
  return !!proxyRouter.syncEngine;
}
