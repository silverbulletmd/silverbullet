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
  "/worker.js",
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

self.addEventListener("fetch", (event: any) => {
  const url = new URL(event.request.url);

  // Use the custom cache key if available, otherwise use the request URL
  const cacheKey = precacheFiles[url.pathname] || event.request.url;

  event.respondWith(
    caches.match(cacheKey)
      .then((response) => {
        // Return the cached response if found
        if (response) {
          // console.log("Cached", event.request);
          return response;
        }

        const requestUrl = new URL(event.request.url);
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
        event.source.postMessage({ type: "cacheFlushed" });
      });
  }
});
