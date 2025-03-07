import { safeRun } from "$lib/async.ts";
import { Client, type ClientConfig } from "./client.ts";

safeRun(async () => {
  // First we fetch the client config from the server (or cached via service worker)
  let clientConfig: ClientConfig | undefined;
  try {
    clientConfig = await (await fetch("/.config")).json();
  } catch (e) {
    console.error("Failed to fetch client config", e);
    alert(
      "Could not fetch configuration from server. Make sure you have an internet connection.",
    );
    return;
  }
  console.log("Client config", clientConfig);
  clientConfig!.syncMode = clientConfig!.syncOnly ||
    !!localStorage.getItem("syncMode");
  console.log(
    "Booting SilverBullet client",
    clientConfig!.syncMode ? "in Sync Mode" : "in Online Mode",
  );

  if (clientConfig!.readOnly) {
    console.log("Running in read-only mode");
  }
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
          "New service worker activated, please reload to activate the new version.",
        );
      }
    });

    if (clientConfig!.syncMode) {
      navigator.serviceWorker.ready.then((registration) => {
        registration.active!.postMessage({
          type: "config",
          config: clientConfig,
        });
      });
    }
  } else {
    console.warn(
      "Not launching service worker, likely because not running from localhost or over HTTPs. This means SilverBullet will not be available offline.",
    );
  }
  const client = new Client(
    document.getElementById("sb-root")!,
    clientConfig!,
  );
  // @ts-ignore: on purpose
  globalThis.client = client;
  await client.init();
});

if (!globalThis.indexedDB) {
  alert(
    "SilverBullet requires IndexedDB to operate and it is not available in your browser. Please use a recent version of Chrome, Firefox (not in private mode) or Safari.",
  );
}
