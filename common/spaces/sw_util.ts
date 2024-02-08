export function flushCachesAndUnregisterServiceWorker() {
  return new Promise<void>((resolve) => {
    if (!navigator.serviceWorker) {
      console.log("No service worker active");
      return resolve();
    }

    navigator.serviceWorker.addEventListener("message", (event) => {
      if (event.data.type === "cacheFlushed") {
        console.log("Cache flushed");
        // Then unregister all service workers
        navigator.serviceWorker.getRegistrations().then((registrations) => {
          for (const registration of registrations) {
            registration.unregister();
            console.log("Service worker unregistered");
            resolve();
          }
        });
      }
    });

    // First flush active cache
    navigator.serviceWorker.ready.then((registration) => {
      registration.active!.postMessage({ type: "flushCache" });
    });
  });
}
