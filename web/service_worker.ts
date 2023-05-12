import { compareSpecs } from "https://deno.land/std@0.152.0/http/_negotiation/common.ts";

const CACHE_NAME = "{{CACHE_NAME}}";

const precacheFiles = [
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
  "/service_worker.js",
  "/worker.js",
];

self.addEventListener("install", (event: any) => {
  console.log("Installing...");
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log("Now preaching", precacheFiles);
        return cache.addAll(precacheFiles);
      }),
  );
});

self.addEventListener("activate", (event: any) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log("Removing old cache", cacheName);
            return caches.delete(cacheName);
          }
        }),
      );
    }),
  );
});

self.addEventListener("fetch", (event: any) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // Return the cached response if found
        if (response) {
          // console.log("Cached", event.request);
          return response;
        }

        const requestUrl = new URL(event.request.url);
        if (!requestUrl.pathname.startsWith("/fs")) {
          // Page, let's serve index.html
          return caches.match(`${requestUrl.origin}/`);
        }

        return fetch(event.request);
      }),
  );
});

self.addEventListener("message", (event: any) => {
  if (event.data.type === "flushCache") {
    caches.delete(CACHE_NAME)
      .then(() => {
        console.log("Cache deleted");
        event.source.postMessage({ type: "cacheFlushed" });
      });
  }
});
