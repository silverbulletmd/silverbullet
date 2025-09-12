import type { SysCallMapping } from "../../lib/plugos/system.ts";
import type { Client } from "../client.ts";

// TODO: Reimplement this
export function syncSyscalls(client: Client): SysCallMapping {
  return {
    "sync.hasInitialSyncCompleted": (): boolean => {
      return client.fullSyncCompleted;
    },
    "sync.performFileSync": (_ctx, path: string): Promise<void> => {
      client.postServiceWorkerMessage({ type: "perform-file-sync", path });
      return waitForServiceWorkerActivation(path);
    },
    "sync.performSpaceSync": (): Promise<number> => {
      client.postServiceWorkerMessage({ type: "perform-space-sync" });
      return waitForServiceWorkerActivation();
    },
  };
}

function waitForServiceWorkerActivation(path?: string): Promise<any> {
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
      // If data.path is set, we are notified about a specific file sync -> all good, even for an individual file sync
      // If data.path is not set, we are notified about a full space sync
      // If we were waiting for a specific path, ignore other paths
      if (data.path && path && data.path !== path) {
        // Event for other file sync
        return;
      }
      // If we were waiting for a specific path, ignore other paths
      resolve(data);

      // Unsubscribe from all these events
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
    function errorHandler(e: any) {
      reject(e);
      // Unsubscribe from all these events
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
