import type { SysCallMapping } from "../system.ts";
import type { Client } from "../../client.ts";

export function syncSyscalls(client: Client): SysCallMapping {
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
        return waitForServiceWorkerActivation(client, path);
      }
    },
    "sync.performSpaceSync": async (): Promise<number> => {
      await client.postServiceWorkerMessage({ type: "perform-space-sync" });
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration?.active) {
        return waitForServiceWorkerActivation(client);
      }
      return 0;
    },
  };
}

function waitForServiceWorkerActivation(
  client: Client,
  path?: string,
): Promise<any> {
  return new Promise<any>((resolve, reject) => {
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
      resolve(data);
      cleanup();
    }
    function errorHandler(e: any) {
      reject(e);
      cleanup();
    }
    function cleanup() {
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
  });
}
