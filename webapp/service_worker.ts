import { manifest, version } from "@parcel/service-worker";

async function install() {
  const cache = await caches.open(version);
  // console.log("Installing", manifest);
  await cache.addAll(manifest);
  // console.log("DOne");
}
//@ts-ignore
self.addEventListener("install", (e) => e.waitUntil(install()));

async function activate() {
  const keys = await caches.keys();
  // console.log("Activating");
  await Promise.all(keys.map((key) => key !== version && caches.delete(key)));
  // console.log("DOne activating");
}
//@ts-ignore
self.addEventListener("activate", (e) => e.waitUntil(activate()));

self.addEventListener("fetch", (event: any) => {
  return;
  event.respondWith(
    caches.open(version).then(async (cache) => {
      let parsedUrl = new URL(event.request.url);
      // console.log("Got fetch request", parsedUrl.pathname);
      let response = await cache.match(event.request, {
        ignoreSearch: true,
      });
      // console.log("Got cache result", response);
      if (response) {
        return response;
      } else {
        if (
          parsedUrl.pathname !== "/fs" &&
          !parsedUrl.pathname.startsWith("/fs/") &&
          !parsedUrl.pathname.startsWith("/plug/")
        ) {
          return cache.match("/index.html");
        }
        return fetch(event.request);
      }
    })
  );
});
