import { safeRun } from "../lib/async.ts";
import { notAuthenticatedError, offlineError } from "../lib/constants.ts";
import { initLogger } from "../lib/logger.ts";
import { extractSpaceLuaFromPageText, loadConfig } from "./boot_config.ts";
import { Client } from "./client.ts";
import type { Config } from "./config.ts";
import {
  flushCachesAndUnregisterServiceWorker,
} from "./service_worker/util.ts";
import "./polyfills.ts";
import type { BootConfig } from "./ui_types.ts";
import { BoxProxy } from "../lib/box_proxy.ts";

initLogger("[Client]");

safeRun(async () => {
  // First we attempt to fetch the config from the server
  let bootConfig: BootConfig | undefined;
  let config: Config | undefined;
  // Placeholder proxy for Client object to be swapped in later
  const clientProxy = new BoxProxy({});
  try {
    const [configJSONText, ...bootstrapLuaScriptPages] = await Promise
      .all([
        cachedFetch(".config"),
        // Some minimal bootstrap Lua: schema definition
        cachedFetch(".fs/Library/Std/Schema.md"),
        // Configuration option definitions and defaults
        cachedFetch(".fs/Library/Std/Config.md"),
        // Custom configuration
        cachedFetch(".fs/CONFIG.md"),
      ]);
    bootConfig = JSON.parse(configJSONText);
    const bootstrapLuaCodes = bootstrapLuaScriptPages.map(
      extractSpaceLuaFromPageText,
    );
    // Append and evaluate
    config = await loadConfig(
      bootstrapLuaCodes.join("\n"),
      clientProxy.buildProxy(),
    );
  } catch (e: any) {
    console.error("Failed to process config", e.message);
    alert(
      "Could not process config and no cached copy, please connect to the Internet",
    );
    return;
  }

  await augmentBootConfig(bootConfig!, config!);

  // Update the browser URL to no longer contain the query parameters using pushState
  if (location.search) {
    const newURL = new URL(location.href);
    newURL.search = "";
    history.pushState({}, "", newURL.toString());
  }
  console.log("Booting SilverBullet client");
  console.log("Boot config", bootConfig, config.values);

  if (localStorage.getItem("enableSW") !== "0" && navigator.serviceWorker) {
    // Register service worker
    const workerURL = new URL("service_worker.js", document.baseURI);
    let startNotificationCount = 0;
    let lastStartNotification = 0;
    navigator.serviceWorker.addEventListener("message", (event) => {
      if (event.data.type === "service-worker-started") {
        // Service worker started, let's make sure it the current config
        console.log(
          "Got notified that service worker has just started, sending config",
          bootConfig,
        );
        navigator.serviceWorker.ready.then((registration) => {
          registration.active!.postMessage({
            type: "config",
            config: bootConfig,
          });
        });
        // Check for weird restart behavior
        startNotificationCount++;
        if (Date.now() - lastStartNotification > 5000) {
          // Last restart was longer than 5s ago: this is fine
          startNotificationCount = 0;
        }
        if (startNotificationCount > 2) {
          // This is not normal. Safari sometimes gets stuck on a database connection if the service worker is updated which means it cannot boot properly
          // the only know fix is to quit the browser and restart it
          alert(
            "Something is wrong with the sync engine, please quit your browser and restart it.",
          );
        }
        lastStartNotification = Date.now();
      }
    });
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

        // Send the config
        registration.active?.postMessage({
          type: "config",
          config: bootConfig,
        });

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

    // // Handle service worker controlled changes (when a new service worker takes over)
    // navigator.serviceWorker.addEventListener("controllerchange", async () => {
    //   console.log(
    //     "New service worker activated!",
    //   );
    // });
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
  clientProxy.setTarget(client);
  await client.init();
  if (navigator.serviceWorker) {
    navigator.serviceWorker.addEventListener("message", (event) => {
      client.handleServiceWorkerMessage(event.data);
    });
  }
});

/**
 * Augments the boot config with values from the page's search params
 * as well as well as Lua-based configuration from CONFIG
 */
async function augmentBootConfig(bootConfig: BootConfig, config: Config) {
  // Pull out sync configuration
  bootConfig.syncDocuments = config.get<boolean>(["sync", "documents"], false);
  let syncIgnore = config!.get<string | string[]>(["sync", "ignore"], "");
  if (Array.isArray(syncIgnore)) {
    syncIgnore = syncIgnore.join("\n");
  }
  bootConfig.syncIgnore = syncIgnore;

  // Then we augment the config based on the URL arguments
  const urlParams = new URLSearchParams(location.search);
  if (urlParams.has("readOnly")) {
    bootConfig.readOnly = true;
  }
  if (urlParams.has("disableSpaceLua")) {
    bootConfig.disableSpaceLua = true;
  }
  if (urlParams.has("disablePlugs")) {
    bootConfig.disablePlugs = true;
  }
  if (urlParams.has("disableSpaceStyle")) {
    bootConfig.disableSpaceStyle = true;
  }
  if (urlParams.has("wipeClient")) {
    bootConfig.performWipe = true;
  }
  if (urlParams.has("resetClient")) {
    bootConfig.performReset = true;
  }
  if (urlParams.has("enableSW")) {
    const val = urlParams.get("enableSW")!;
    localStorage.setItem("enableSW", val);
    if (val === "0") {
      await flushCachesAndUnregisterServiceWorker();
    }
  }
}

if (!globalThis.indexedDB) {
  alert(
    "SilverBullet requires IndexedDB to operate and it is not available in your browser. Please use a recent version of Chrome, Firefox (not in private mode) or Safari.",
  );
}

async function cachedFetch(path: string): Promise<string> {
  const cacheKey = `silverbullet.${document.baseURI}.${path}`;
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
