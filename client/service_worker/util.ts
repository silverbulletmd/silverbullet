export async function unregisterServiceWorkers() {
  if (navigator.serviceWorker) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    for (const registration of registrations) {
      await registration.unregister();
      console.log("Service worker unregistered");
    }
  } else {
    console.error("No service worker found to unregister");
  }
}

/**
 * Ask the controlling worker to drop its caches, then unregister every worker.
 * Boot waits on this, so it never takes longer than `timeoutMs`: a worker that
 * doesn't confirm in time is unregistered without the flush.
 */
export function flushCachesAndUnregisterServiceWorker(timeoutMs = 3000) {
  console.log("Going to flush the caches and unregister the service worker");
  return new Promise<void>((resolve) => {
    if (!navigator.serviceWorker?.controller) {
      console.log("No service worker active");
      return resolve();
    }
    let done = false;
    const unregisterAll = async () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        for (const registration of await navigator.serviceWorker.getRegistrations()) {
          await registration.unregister();
          console.log("Service worker unregistered");
        }
      } catch (e) {
        console.error("Could not unregister service worker", e);
      }
      resolve();
    };
    const timer = setTimeout(() => {
      console.warn("Service worker did not confirm the cache flush in time");
      void unregisterAll();
    }, timeoutMs);

    navigator.serviceWorker.addEventListener("message", (event) => {
      if (event.data.type === "cacheFlushed") {
        console.log("Cache flushed");
        void unregisterAll();
      }
    });

    void navigator.serviceWorker.ready.then((registration) => {
      console.log("Sending request to flush cache");
      registration.active?.postMessage({ type: "flush-cache" });
    });
  });
}
