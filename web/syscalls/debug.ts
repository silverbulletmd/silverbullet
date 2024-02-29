import { KvKey } from "../../plug-api/types.ts";
import type { SysCallMapping } from "../../lib/plugos/system.ts";
import { Client } from "../client.ts";

export function debugSyscalls(client: Client): SysCallMapping {
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
    "debug.cleanup": async () => {
      if (client.spaceKV) {
        console.log("Wiping the entire space KV store");
        // In sync mode, we can just delete the whole space
        const allKeys: KvKey[] = [];
        for await (const { key } of client.spaceKV.query({})) {
          allKeys.push(key);
        }
        await client.spaceKV.batchDelete(allKeys);
      }
      localStorage.clear();
      console.log("Wiping the entire state KV store");
      await client.stateDataStore.queryDelete({});
      console.log("Done");
    },
  };
}
