import { wrongSpacePathError } from "@silverbulletmd/silverbullet/constants";
import { throttleImmediately } from "@silverbulletmd/silverbullet/lib/async";
import {
  deriveDbName,
  exportKey,
  importKey,
} from "@silverbulletmd/silverbullet/lib/crypto";
import { EncryptedKvPrimitives } from "./data/encrypted_kv_primitives.ts";
import { IndexedDBKvPrimitives } from "./data/indexeddb_kv_primitives.ts";
import type { KvPrimitives } from "./data/kv_primitives.ts";
import { initLogger } from "./lib/logger.ts";
import { ProxyRouter } from "./service_worker/proxy_router.ts";
import { SyncEngine } from "./service_worker/sync_engine.ts";
import { getOrCreateClientId } from "./spaces/client_id.ts";
import { fsEndpoint } from "./spaces/constants.ts";
import { DataStoreSpacePrimitives } from "./spaces/datastore_space_primitives.ts";
import { HttpSpacePrimitives } from "./spaces/http_space_primitives.ts";
import { decodeSafetyText } from "./sync_recovery.ts";
import type {
  ServiceWorkerSourceMessage,
  ServiceWorkerTargetMessage,
} from "./types/ui.ts";

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

const precacheFiles = Object.fromEntries(
  // Dynamically replaced during build
  "{{PRECACHE_FILES}}"
    .split(",")
    .map((path) => [path, `${baseURI}${path}?v=${CACHE_NAME}`, path]),
); // Cache busting

// Initially set to undefined, resulting in all "fetch" being proxied.
// Once the service worker is configured, this will be set and the proxy will handle fetches.
const proxyRouter = new ProxyRouter(basePathName, baseURI, precacheFiles);

// Configuration mutex
let configuring = false;

// @ts-expect-error: debugging
globalThis.proxyRouter = proxyRouter;

// This is the in-memory store of an encryption key that SB clients and the index engine can share without asking for it constantly
let encryptionKeyMemoryStore: CryptoKey | undefined;

// Let's clean this encryptionKey if there's no more clients left for a little while, asking to re-enter
setInterval(() => {
  // @ts-expect-error: service worker API
  globalThis.clients.matchAll().then((clients) => {
    if (clients.length === 0 && encryptionKeyMemoryStore) {
      console.info("No more clients, flushing encryption key");
      encryptionKeyMemoryStore = undefined;
    }
  });
}, 5000); // little while is 5s

// Message received from client
self.addEventListener("message", async (event: any) => {
  const message: ServiceWorkerTargetMessage = event.data;
  switch (message.type) {
    case "skip-waiting": {
      // @ts-expect-error: Skip waiting to activate this service worker immediately
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
        proxyRouter.syncEngine.requestFileSync(
          message.path,
          message.remoteLastModified !== undefined
            ? {
                type: "remote",
                lastModified: message.remoteLastModified,
                hash: message.remoteRevisionHash,
              }
            : { type: "any" },
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
        proxyRouter.syncEngine.requestSpaceSync();
      } else {
        console.warn(
          "Ignoring perform-space-sync request, proxy not configured yet",
        );
      }
      break;
    }
    case "declare-divergent-base": {
      await proxyRouter.syncEngine?.declareDivergentBase(
        message.path,
        message.baseText,
      );
      // The client waits for this before writing the divergent buffer.
      event.ports[0]?.postMessage({ type: "divergent-base-declared" });
      break;
    }
    case "realtime-status": {
      proxyRouter.syncEngine?.notifyRealtimeStatus(message.connected);
      break;
    }
    case "get-encryption-key": {
      event.source.postMessage({
        type: "encryption-key",
        key:
          encryptionKeyMemoryStore &&
          (await exportKey(encryptionKeyMemoryStore)),
      } as ServiceWorkerSourceMessage);
      break;
    }
    case "set-encryption-key": {
      encryptionKeyMemoryStore = await importKey(message.key);
      console.info("Encryption phrase set");
      event.ports[0]?.postMessage({ type: "encryption-key-set" });
      break;
    }
    case "list-safety": {
      const raw = (await proxyRouter.syncEngine?.listSafety()) ?? [];
      const entries = await Promise.all(
        raw.map(async (entry) => {
          const data = await proxyRouter.syncEngine?.getSafety(entry.hash);
          return {
            ...entry,
            binary: data ? decodeSafetyText(data) === null : true,
          };
        }),
      );
      event.source.postMessage({
        type: "safety-list",
        entries,
      } as ServiceWorkerSourceMessage);
      break;
    }
    case "get-safety": {
      const data =
        (await proxyRouter.syncEngine?.getSafety(message.hash)) ?? null;
      event.source.postMessage({
        type: "safety-content",
        hash: message.hash,
        data,
      } as ServiceWorkerSourceMessage);
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
        if (config.enableClientEncryption) {
          if (!encryptionKeyMemoryStore) {
            console.error(
              "Supposed to use encryption, but no phrase set yet, auth error",
            );
            broadcastMessage({
              type: "auth-error",
              message: "Re-authentication required, redirecting...",
              actionOrRedirectHeader: ".auth",
            });
            // ABORT
            return;
          }
        }

        const spaceFolderPath = config.spaceFolderPath;
        const dbName = await deriveDbName(
          "files",
          spaceFolderPath,
          baseURI,
          encryptionKeyMemoryStore,
        );

        if (config.logPush) {
          setInterval(() => {
            void logger.postToServer(".logs", "service_worker");
          }, 1000);
        }

        // Setup KV (database) for store synced files
        let kv: KvPrimitives = new IndexedDBKvPrimitives(dbName);
        await (kv as IndexedDBKvPrimitives).init();
        console.log("Using IndexedDB database", dbName);

        if (encryptionKeyMemoryStore) {
          kv = new EncryptedKvPrimitives(kv, encryptionKeyMemoryStore);
          await (kv as EncryptedKvPrimitives).init();
          console.log("Enabled client-side encryption for synced files");
        }

        // And use that to power the IndexedDB backed local storage
        const local = new DataStoreSpacePrimitives(kv);

        const clientId = await getOrCreateClientId(kv);

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
          undefined,
          clientId,
          "sync",
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
            syncEngine.requestFileSync(path, { type: "probe" });
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
          suppressedDeletion: (path) => {
            broadcastMessage({
              type: "suppressed-deletion",
              path,
            });
          },
          spaceSyncComplete: (operations) => {
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
          syncError: (error, path) => {
            broadcastMessage({
              type: "sync-error",
              message: error.message,
              path,
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
  // @ts-expect-error: service worker API
  const clients: any = self.clients;
  // Find all windows attached to this service worker
  clients
    .matchAll({
      type: "window",
    })
    .then((clients: any[]) => {
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
      console.log("Now pre-caching client files");
      await cache.addAll(
        Object.values<string>(precacheFiles).map(
          (url) => new Request(url, { cache: "reload" }),
        ),
      );
      console.log(Object.keys(precacheFiles).length, "client files cached");
      // @ts-expect-error: Force the waiting service worker to become the active service worker
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
      // Flush old caches
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log("Removing old cache", cacheName);
            return caches.delete(cacheName);
          }
        }),
      );
      // @ts-expect-error: Take control of all clients as soon as the service worker activates
      await clients.claim();
    })(),
  );
});

console.log("Service worker loaded");

function isConfigured() {
  return !!proxyRouter.syncEngine;
}
