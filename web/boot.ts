import { safeRun } from "../lib/async.ts";
import { Client } from "./client.ts";

const syncMode = globalThis.silverBulletConfig.syncOnly ||
  !!localStorage.getItem("syncMode");

safeRun(async () => {
  console.log(
    "Booting SilverBullet client",
    syncMode ? "in Sync Mode" : "in Online Mode",
  );

  if (globalThis.silverBulletConfig.readOnly) {
    console.log("Running in read-only mode");
  }

  const client = new Client(
    document.getElementById("sb-root")!,
    syncMode,
    globalThis.silverBulletConfig.readOnly,
  );
  // @ts-ignore: on purpose
  globalThis.client = client;
  await client.init();
});

if (navigator.serviceWorker) {
  // Register service worker
  navigator.serviceWorker
    .register(new URL("/service_worker.js", location.href), {
      type: "module",
    })
    .then((registration) => {
      console.log("Service worker registered...");

      // Set up update detection
      registration.addEventListener("updatefound", () => {
        const newWorker = registration.installing;
        console.log("New service worker installing...");

        if (newWorker) {
          newWorker.addEventListener("statechange", () => {
            if (
              newWorker.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              console.log(
                "New service worker installed and ready to take over.",
              );
              // Force the new service worker to activate immediately
              newWorker.postMessage({ type: "skipWaiting" });
            }
          });
        }
      });
    });

  // Handle service worker controlled changes (when a new service worker takes over)
  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!refreshing) {
      refreshing = true;
      console.log(
        "New service worker activated, reloading page to apply updates...",
      );
      globalThis.location.reload();
    }
  });

  if (syncMode) {
    navigator.serviceWorker.ready.then((registration) => {
      registration.active!.postMessage({
        type: "config",
        config: globalThis.silverBulletConfig,
      });
    });
  }
} else {
  console.warn(
    "Not launching service worker, likely because not running from localhost or over HTTPs. This means SilverBullet will not be available offline.",
  );
}

if (!globalThis.indexedDB) {
  alert(
    "SilverBullet requires IndexedDB to operate and it is not available in your browser. Please use a recent version of Chrome, Firefox (not in private mode) or Safari.",
  );
}
