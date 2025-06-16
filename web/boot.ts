import { safeRun } from "../lib/async.ts";
import { Client, type ClientConfig } from "./client.ts";

const configCacheKey = `silverbullet.${document.baseURI}.config`;

safeRun(async () => {
  // First we attempt to fetch the config from the server
  let clientConfig: ClientConfig | undefined;
  try {
    const configResponse = await fetch(".config", {
      // We don't want to follow redirects, we want to get the redirect header in case of auth issues
      redirect: "manual",
      // Add short timeout in case of a bad internet connection, this would block loading of the UI
      signal: AbortSignal.timeout(1000),
    });
    const redirectHeader = configResponse.headers.get("location");
    if (
      configResponse.status === 401 && redirectHeader
    ) {
      alert(
        "Received an authentication redirect, redirecting to URL: " +
          redirectHeader,
      );
      location.href = redirectHeader;
      return;
    }
    clientConfig = await configResponse.json();
    // Persist to localStorage
    localStorage.setItem(configCacheKey, JSON.stringify(clientConfig));
  } catch (e: any) {
    console.error("Failed to fetch client config from server", e.message);
    // We may be offline, let's see if we have a cached config
    const configString = localStorage.getItem(configCacheKey);
    if (configString) {
      // Yep! Let's use it
      clientConfig = JSON.parse(configString);
    } else {
      alert(
        "Could not fetch configuration from server. Make sure you have an internet connection.",
      );
      // Returning here because there's no way to recover from this
      return;
    }
  }
  console.log("Client config", clientConfig);
  console.log("Booting SilverBullet client");

  if (clientConfig!.readOnly) {
    console.log("Running in read-only mode");
  }
  if (navigator.serviceWorker) {
    // Register service worker
    const workerURL = new URL("service_worker.js", document.baseURI);
    navigator.serviceWorker
      .register(workerURL, {
        type: "module",
        //limit the scope of the service worker to any potential URL prefix
        scope: workerURL.pathname.substring(
          0,
          workerURL.pathname.lastIndexOf("/") + 1,
        ),
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

    navigator.serviceWorker.ready.then((registration) => {
      registration.active!.postMessage({
        type: "config",
        config: clientConfig,
      });
    });
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
