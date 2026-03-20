import type { SysCallMapping } from "../system.ts";
import type { Client } from "../../client.ts";

export function syncSyscalls(client: Client): SysCallMapping {
  const syncTimeoutMs = 30000;

  function waitForServiceWorkerActivation(path?: string): Promise<any> {
    return new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error(`Sync timeout after ${syncTimeoutMs / 1000}s`));
      }, syncTimeoutMs);

      function cleanup() {
        clearTimeout(timeout);
        client.eventHook.removeLocalListener(
          "service-worker:file-sync-complete",
          eventHandler,
        );
        client.eventHook.removeLocalListener(
          "service-worker:space-sync-complete",
          eventHandler,
        );
        client.eventHook.removeLocalListener(
          "service-worker:sync-error",
          errorHandler,
        );
      }

      client.eventHook.addLocalListener(
        "service-worker:file-sync-complete",
        eventHandler,
      );
      client.eventHook.addLocalListener(
        "service-worker:space-sync-complete",
        eventHandler,
      );
      client.eventHook.addLocalListener(
        "service-worker:sync-error",
        errorHandler,
      );

      function eventHandler(data: any) {
        if (data.path && path && data.path !== path) {
          return;
        }
        cleanup();
        resolve(data);
      }

      function errorHandler(e: any) {
        // Only reject if the error is for our specific path, or if no path was specified
        if (e.path && path && e.path !== path) {
          return;
        }
        cleanup();
        reject(e);
      }
    });
  }

  return {
    "sync.hasInitialSyncCompleted": (): boolean => {
      return client.fullSyncCompleted;
    },
    "sync.performFileSync": async (_ctx, path: string): Promise<void> => {
      await client.postServiceWorkerMessage({
        type: "perform-file-sync",
        path,
      });
      // postServiceWorkerMessage returns silently if no SW, so only wait if SW is active
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration?.active) {
        return waitForServiceWorkerActivation(path);
      }
    },
    "sync.performSpaceSync": async (): Promise<number> => {
      await client.postServiceWorkerMessage({ type: "perform-space-sync" });
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration?.active) {
        return waitForServiceWorkerActivation();
      }
      return 0;
    },
  };
}
