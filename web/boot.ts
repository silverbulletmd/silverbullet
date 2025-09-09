import { safeRun } from "../lib/async.ts";
import { notAuthenticatedError, offlineError } from "../lib/constants.ts";
import { initLogger } from "../lib/logger.ts";
import { extractSpaceLuaFromPageText, loadConfig } from "./boot_config.ts";
import { type BootConfig, Client } from "./client.ts";
import type { Config } from "./config.ts";
import {
  flushCachesAndUnregisterServiceWorker,
} from "./service_worker/util.ts";

const configCacheKey = `silverbullet.${document.baseURI}.config`;
const configPageCacheKey = `silverbullet.${document.baseURI}.configPage`;

initLogger("[Client]");

safeRun(async () => {
  // First we attempt to fetch the config from the server
  let bootConfig: BootConfig | undefined;
  try {
    const configText = await cachedFetch(configCacheKey, ".config");
    bootConfig = JSON.parse(configText);
  } catch (e: any) {
    console.error("Failed to fetch config", e.message);
    alert(
      "Could not fetch config and no cached copy, please connect to the Internet",
    );
    return;
  }
  let config: Config | undefined;
  try {
    const confPageText = await cachedFetch(configPageCacheKey, ".fs/CONFIG.md");
    const luaConfigCode = extractSpaceLuaFromPageText(confPageText);
    config = await loadConfig(luaConfigCode);
  } catch (e: any) {
    console.error("Failed to fetch config", e.message);
    alert(
      "Could not fetch config and no cached copy, please connect to the Internet",
    );
    return;
  }
  // Then we augment the config based on the URL arguments
  const urlParams = new URLSearchParams(location.search);
  if (urlParams.has("readOnly")) {
    bootConfig!.readOnly = true;
  }
  if (urlParams.has("disableSpaceLua")) {
    bootConfig!.disableSpaceLua = true;
  }
  if (urlParams.has("disablePlugs")) {
    bootConfig!.disablePlugs = true;
  }
  if (urlParams.has("disableSpaceStyle")) {
    bootConfig!.disableSpaceStyle = true;
  }
  if (urlParams.has("wipeClient")) {
    bootConfig!.performWipe = true;
  }
  if (urlParams.has("resetClient")) {
    bootConfig!.performReset = true;
  }
  if (urlParams.has("enableSW")) {
    const val = urlParams.get("enableSW")!;
    console.log("Got this sw value", val, typeof val);
    localStorage.setItem("enableSW", val);
    if (val === "0") {
      await flushCachesAndUnregisterServiceWorker();
    }
  }

  // Update the browser URL to no longer contain the query parameters using pushState
  if (location.search) {
    const newURL = new URL(location.href);
    newURL.search = "";
    history.pushState({}, "", newURL.toString());
  }
  console.log("Booting SilverBullet client");
  console.log("Boot config", bootConfig);
  console.log("Config", config.values);

  if (localStorage.getItem("enableSW") !== "0" && navigator.serviceWorker) {
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
                newWorker.postMessage({ type: "skip-waiting" });
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
        config: bootConfig,
      });
    });
  } else {
    console.info("Service worker disabled.");
  }
  const client = new Client(
    document.getElementById("sb-root")!,
    bootConfig!,
    config!,
  );
  // @ts-ignore: on purpose
  globalThis.client = client;
  await client.init();
  if (navigator.serviceWorker) {
    navigator.serviceWorker.addEventListener("message", (event) => {
      client.handleServiceWorkerMessage(event.data);
    });
  }
});

if (!globalThis.indexedDB) {
  alert(
    "SilverBullet requires IndexedDB to operate and it is not available in your browser. Please use a recent version of Chrome, Firefox (not in private mode) or Safari.",
  );
}

async function cachedFetch(cacheKey: string, path: string): Promise<string> {
  try {
    const response = await fetch(path, {
      // We don't want to follow redirects, we want to get the redirect header in case of auth issues
      redirect: "manual",
      // Add short timeout in case of a bad internet connection, this would block loading of the UI
      signal: AbortSignal.timeout(1000),
      headers: {
        "X-Sync-Mode": "1",
      },
    });
    if (response.status === 503) {
      // Offline
      const text = localStorage.getItem(cacheKey);
      if (text) {
        console.info("Falling back to cache for", path);
        return text;
      } else {
        throw offlineError;
      }
    }
    const redirectHeader = response.headers.get("location");
    if (
      response.status === 401 && redirectHeader
    ) {
      alert(
        "Received an authentication redirect, redirecting to URL: " +
          redirectHeader,
      );
      location.href = redirectHeader;
      throw notAuthenticatedError;
    }
    const text = await response.text();
    // Persist to localStorage
    localStorage.setItem(cacheKey, text);
    return text;
  } catch {
    console.info("Falling back to cache for", path);
    // We may be offline, let's see if we have a cached config
    const text = localStorage.getItem(cacheKey);
    if (text) {
      // Yep! Let's use it
      return text;
    } else {
      throw offlineError;
    }
  }
}
