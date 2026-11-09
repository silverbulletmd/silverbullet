import {
  notAuthenticatedError,
  offlineError,
} from "@silverbulletmd/silverbullet/constants";
import { safeRun } from "@silverbulletmd/silverbullet/lib/async";
import { applyCachedFonts } from "@silverbulletmd/silverbullet/lib/fonts";
import { loadConfig } from "./boot_config.ts";
import { loadBootFiles } from "./boot_fetch.ts";
import { Client } from "./client.ts";
import type { Config } from "./config.ts";
import { initLogger } from "./lib/logger.ts";
import { logoutInProgress } from "./logout.ts";
import { waitForLogout } from "./logout_state.ts";
import {
  flushCachesAndUnregisterServiceWorker,
  unregisterServiceWorkers,
} from "./service_worker/util.ts";
import "./lib/polyfills.ts";
import { exportKey, importKey } from "@silverbulletmd/silverbullet/lib/crypto";
import { BoxProxy } from "./lib/box_proxy.ts";
import type { BootConfig } from "./types/ui.ts";
import "./debug.ts";
import { recordMark } from "./lib/perf.ts";
import { bootBlocks } from "./tooling.ts";
import { bootToolingCache } from "./tooling_cache.ts";
import {
  fetchTooling,
  resolveBootTooling,
  type Tooling,
} from "./tooling_fetch.ts";
import { consoleLog } from "./workbench/console/console_log.ts";

// Initialize the runtime-bridge namespace. `??=` preserves any value an
// earlier init script may have already installed (desktop wrapper does this)
globalThis.sbRuntime ??= {};

const logger = initLogger("[Client]");

/**
 * Ask every same-origin SilverBullet service worker for an in-memory client
 * encryption key. Prefix-bound spaces have separate worker scopes, but an
 * account-managed server deliberately uses one salt and key across them.
 */
async function findEncryptionKey(
  accountManaged: boolean,
): Promise<CryptoKey | undefined> {
  if (!navigator.serviceWorker) {
    return undefined;
  }
  const registrations = accountManaged
    ? await navigator.serviceWorker.getRegistrations()
    : [await navigator.serviceWorker.getRegistration(document.baseURI)].filter(
        (registration): registration is ServiceWorkerRegistration =>
          !!registration,
      );
  if (registrations.length === 0) {
    return undefined;
  }
  return await new Promise<CryptoKey | undefined>((resolve) => {
    let settled = false;
    const finish = (key?: CryptoKey) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      navigator.serviceWorker.removeEventListener("message", listener);
      resolve(key);
    };
    const listener = (event: MessageEvent) => {
      if (event.data?.type === "encryption-key" && event.data.key) {
        void importKey(event.data.key).then(finish);
      }
    };
    const timeout = setTimeout(() => finish(), 250);
    navigator.serviceWorker.addEventListener("message", listener);
    for (const registration of registrations) {
      registration.active?.postMessage({ type: "get-encryption-key" });
    }
  });
}

safeRun(async () => {
  // Before anything awaits, so the first paint already uses the last fonts.
  applyCachedFonts();
  consoleLog.install({
    console,
    addEventListener: globalThis.addEventListener.bind(globalThis),
    serviceWorker: navigator.serviceWorker,
  });
  if (!(await waitForLogout())) return;
  const clientReady = Promise.withResolvers<Client>();
  navigator.serviceWorker?.addEventListener("message", (event) => {
    // Sync can finish while init is still loading the index and plugins.
    void clientReady.promise.then((client) =>
      client.handleServiceWorkerMessage(event.data),
    );
  });
  recordMark("sb:boot-start");
  let bootConfig: BootConfig | undefined;
  let config: Config | undefined;
  // Placeholder proxy for Client object to be swapped in later
  const clientProxy = new BoxProxy({});
  // Alongside the boot config, which decides what a failed fetch falls back to
  const toolingFetch = fetchTooling(globalThis.fetch.bind(globalThis)).catch(
    (e: Error) => e,
  );
  let tooling: Tooling | undefined;
  try {
    const { configText } = await loadBootFiles(".config", {
      fetch: globalThis.fetch.bind(globalThis),
      storage: localStorage,
      cacheKeyPrefix: `silverbullet.${document.baseURI}.`,
      logoutInProgress,
      resetAndReload: async () => {
        await unregisterServiceWorkers();
        console.log("Ok, now going to reload, let's hope for the best");
        location.reload();
      },
      navigate: (url) => {
        location.href = url;
      },
    });
    bootConfig = JSON.parse(configText);
    tooling = await resolveBootTooling(
      await toolingFetch,
      bootToolingCache(!!bootConfig!.enableClientEncryption, document.baseURI),
    );
    if (!navigator.serviceWorker) bootConfig!.disableServiceWorker = true;
    if (!globalThis.isSecureContext) bootConfig!.enableClientEncryption = false;
  } catch (e: any) {
    if (e.message === offlineError.message) {
      alert(
        "Could not process config and no cached copy, please connect to the Internet",
      );
      return;
    }
    if (e.message === notAuthenticatedError.message) {
      // A redirect to the login page is already under way; stop booting.
      return;
    }
    // Anything else (e.g. no space is bound at this URL and nothing is cached)
    // leaves bootConfig undefined. Falling through would throw an opaque
    // TypeError further down and bury the real cause — stop here and report
    // what actually failed.
    console.error("Could not load boot config:", e);
    alert(`Could not load this space: ${e.message}`);
    return;
  }
  try {
    // Blocks run isolated: one that fails to parse or run is logged and skipped
    config = await loadConfig(
      bootBlocks(tooling?.scripts ?? []),
      clientProxy.buildProxy(),
      !!bootConfig?.readOnly,
    );
  } catch (e: any) {
    console.error("Boot error", e);
    alert("Could not load boot scripts, check your browser's logs");
    return;
  }

  let encryptionKey: CryptoKey | undefined;
  if (
    localStorage.getItem("enableEncryption") &&
    bootConfig?.enableClientEncryption
  ) {
    console.log("Initializing encryption");
    console.log("Querying SilverBullet service workers for an encryption key");
    encryptionKey = await findEncryptionKey(!!bootConfig.accountManaged);
    if (!encryptionKey) {
      console.warn(
        "No client encryption key available, redirecting to auth page",
      );
      location.href = ".auth";
      throw new Error("Not authenticated");
    }
  } else {
    bootConfig!.enableClientEncryption = false;
  }

  await augmentBootConfig(bootConfig!, config!);

  const isHeadless = new URLSearchParams(location.search).has("headless");
  globalThis.sbRuntime.captureId =
    new URLSearchParams(location.search).get("capture") ?? undefined;
  const reviewGitConflicts =
    new URLSearchParams(location.search).get("gitConflicts") === "1";
  // Expose headless flag on the runtime bridge so client.init() can detect
  // it after URL params are stripped.
  if (isHeadless) {
    globalThis.sbRuntime.headless = true;
  }

  if (location.search) {
    const newURL = new URL(location.href);
    newURL.search = "";
    history.pushState({}, "", newURL.toString());
  }
  recordMark("sb:config-loaded");
  console.log("Booting SilverBullet client");
  console.log("Boot config", bootConfig, config.values);

  const swDisabled = !!bootConfig?.disableServiceWorker;
  if (swDisabled && navigator.serviceWorker) {
    await flushCachesAndUnregisterServiceWorker();
  }
  if (!isHeadless && !swDisabled && navigator.serviceWorker) {
    const workerURL = new URL("service_worker.js", document.baseURI);
    const configureWorker = async (registration: ServiceWorkerRegistration) => {
      const worker = registration.active;
      if (!worker) return;
      if (encryptionKey) {
        worker.postMessage({
          type: "set-encryption-key",
          key: await exportKey(encryptionKey),
        });
      }
      worker.postMessage({
        type: "config",
        config: bootConfig,
      });
    };
    let startNotificationCount = 0;
    let lastStartNotification = 0;
    navigator.serviceWorker.addEventListener("message", (event) => {
      if (event.data.type === "service-worker-started") {
        console.log(
          "Got notified that service worker has just started, sending config",
          bootConfig,
        );
        navigator.serviceWorker.ready.then(configureWorker);
        startNotificationCount++;
        if (Date.now() - lastStartNotification > 5000) {
          startNotificationCount = 0;
        }
        if (startNotificationCount > 2) {
          // This is not normal. Safari sometimes gets stuck on a database connection if the service worker is updated which means it cannot boot properly
          // the only know fix is to quit the browser and restart it
          console.warn(
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

        // Send the shared encryption key before configuration initializes the
        // encrypted data store for this prefix.
        void configureWorker(registration);

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
                newWorker.postMessage({ type: "skip-waiting" });
              }
            });
          }
        });
      });
  } else {
    console.info("Service worker disabled.");
  }
  if (!(await waitForLogout())) return;
  const client = new Client(
    document.getElementById("sb-root")!,
    bootConfig!,
    config!,
    tooling,
  );
  if (bootConfig!.logPush) {
    setInterval(() => {
      void logger.postToServer(".logs", "client");
    }, 1000);
  }
  globalThis.client = client;
  clientProxy.setTarget(client);
  await client.init(encryptionKey);
  clientReady.resolve(client);
  if (reviewGitConflicts) await client.openNavigatorView("std.gitConflicts");
});

/**
 * Augments the boot config with values from the page's search params
 * as well as well as Lua-based configuration from CONFIG
 */
async function augmentBootConfig(bootConfig: BootConfig, config: Config) {
  bootConfig.syncDocuments = config.get<boolean>(["sync", "documents"], false);
  let syncIgnore = config!.get<string | string[]>(["sync", "ignore"], "");
  if (Array.isArray(syncIgnore)) {
    syncIgnore = syncIgnore.join("\n");
  }
  bootConfig.syncIgnore = syncIgnore;

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
}

if (!globalThis.indexedDB) {
  alert(
    "SilverBullet requires IndexedDB to operate and it is not available in your browser. Please use a recent version of Chrome, Firefox (not in private mode) or Safari.",
  );
}
