import type { SysCallMapping } from "../../plugos/system.ts";

export function debugSyscalls(): SysCallMapping {
  return {
    "debug.resetClient": async () => {
      if (navigator.serviceWorker) {
        const registration = await navigator.serviceWorker.ready;

        if (registration?.active) {
          registration.active.postMessage({ type: "flushCache" });
          await new Promise<void>((resolve) => {
            navigator.serviceWorker.addEventListener("message", (event) => {
              if (event.data.type === "cacheFlushed") {
                console.log("Cache flushed");
                navigator.serviceWorker.getRegistrations().then(
                  async (registrations) => {
                    for (const registration of registrations) {
                      await registration.unregister();
                    }
                    resolve();
                  },
                );
              }
            });
          });
        } else {
          alert("No service worker active, so not unregistering");
        }
      } else {
        alert("Service workers not supported, so not unregistering");
      }
      if (indexedDB.databases) {
        // get a list of all existing IndexedDB databases
        const databases = await indexedDB.databases();
        // loop through the list and delete each database
        for (const database of databases) {
          indexedDB.deleteDatabase(database.name!);
        }
      } else {
        alert("Cannot flush local databases (Firefox user?)");
      }

      // And finally, reload the page
      alert("Reset complete, now reloading the page...");
      location.reload();
    },
  };
}
