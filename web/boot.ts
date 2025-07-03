import { safeRun } from "../lib/async.ts";
import { Client, type ClientConfig } from "./client.ts";

const configCacheKey = `silverbullet.${document.baseURI}.config`;

// Type declarations for global properties
declare global {
  var pendingServiceWorkerUpdate: boolean | undefined;
  var client: Client;
}

// Check IndexedDB availability early but don't block
if (!globalThis.indexedDB) {
  console.error(
    "IndexedDB not available - app will have limited functionality",
  );
  // Still show alert but don't block execution
  setTimeout(() => {
    alert(
      "SilverBullet requires IndexedDB for full functionality. Some features may not work correctly. Please use a recent version of Chrome, Firefox (not in private mode) or Safari.",
    );
  }, 1000);
}

// Helper function for config fetch with timeout
async function fetchConfigWithTimeout(
  timeout: number,
): Promise<Response | null> {
  try {
    return await fetch(".config", {
      redirect: "manual",
      signal: AbortSignal.timeout(timeout),
    });
  } catch (e) {
    console.debug("Config fetch failed:", e);
    return null;
  }
}

safeRun(async () => {
  // First we attempt to fetch the config from the server
  let clientConfig: ClientConfig | undefined;
  try {
    // Try with short timeout first
    let configResponse = await fetchConfigWithTimeout(1000);

    // If failed and we think we're online, retry with longer timeout
    if (!configResponse && navigator.onLine) {
      console.log(
        "Initial config fetch failed, retrying with longer timeout...",
      );
      configResponse = await fetchConfigWithTimeout(3000);
    }

    if (!configResponse) {
      throw new Error("Failed to fetch config after retry");
    }

    const redirectHeader = configResponse.headers.get("location");
    if (configResponse.status === 401 && redirectHeader) {
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
    console.error("Failed to fetch client config from server", e);
    // We may be offline, let's see if we have a cached config
    const configString = localStorage.getItem(configCacheKey);
    if (configString) {
      try {
        const parsed = JSON.parse(configString);
        // Validate it has minimum required fields
        if (
          parsed &&
          typeof parsed === "object" &&
          typeof parsed.spaceFolderPath === "string" &&
          parsed.indexPage !== undefined
        ) {
          clientConfig = parsed;
        } else {
          throw new Error("Invalid config structure");
        }
      } catch (e) {
        console.error("Cached config corrupted:", e);
        // Clear corrupted cache and show error
        localStorage.removeItem(configCacheKey);
        alert(
          "Configuration cache is corrupted and server is unreachable. Please check your internet connection and refresh the page.",
        );
        return;
      }
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

  // Validate clientConfig exists before continuing
  if (!clientConfig) {
    console.error("No client config available");
    return;
  }

  if (clientConfig.readOnly) {
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
      })
      .catch((error) => {
        console.error("Service worker registration failed:", error);
        console.warn("Continuing without offline support");
        // App continues to function without service worker
      });

    // Handle service worker controlled changes (when a new service worker takes over)
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!refreshing) {
        refreshing = true;
        console.log("New service worker activated, notifying user...");

        // Notify user through the client if it's available
        // Note: This event might fire before client is initialized
        if (
          globalThis.client &&
          typeof globalThis.client.flashNotification === "function"
        ) {
          globalThis.client.flashNotification(
            "A new version is available. Please refresh when convenient.",
            "info",
          );
        } else {
          // Fallback: Set a flag for the client to check after initialization
          globalThis.pendingServiceWorkerUpdate = true;
        }
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
  // Validate root element exists
  const rootElement = document.getElementById("sb-root");
  if (!rootElement) {
    alert("Application structure error: Missing root element");
    throw new Error("Missing sb-root element");
  }

  const client = new Client(rootElement, clientConfig);
  // @ts-ignore: on purpose
  globalThis.client = client;
  await client.init();

  // Check for pending service worker update notification
  if (globalThis.pendingServiceWorkerUpdate) {
    client.flashNotification(
      "A new version is available. Please refresh when convenient.",
      "info",
    );
    delete globalThis.pendingServiceWorkerUpdate;
  }
});
