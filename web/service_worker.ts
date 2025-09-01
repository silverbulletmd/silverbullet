// Side effect imports
import { DataStore } from "../lib/data/datastore.ts";
import { ProxyRouter } from "./service_worker/fetch.ts";
import { MessageHandler } from "./service_worker/message.ts";

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

let proxyRouter: ProxyRouter | undefined;

new MessageHandler(self, baseURI, basePathName, (ds: DataStore) => {
  proxyRouter = new ProxyRouter(
    ds,
    basePathName,
    baseURI,
    precacheFiles,
  );
});

self.addEventListener("fetch", (event: any) => {
  if (proxyRouter) {
    proxyRouter.handleFetch(event);
  } else {
    event.respondWith(fetch(event.request));
  }
});
