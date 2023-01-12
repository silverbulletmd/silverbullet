import { store } from "$sb/plugos-syscall/mod.ts";
import { editor, sync, system } from "$sb/silverbullet-syscall/mod.ts";
import type { SyncEndpoint } from "$sb/silverbullet-syscall/sync.ts";

export async function configureCommand() {
  const url = await editor.prompt(
    "Enter the URL of the remote space to sync with",
    "https://",
  );
  if (!url) {
    return;
  }

  const user = await editor.prompt("Username (if any):");
  let password = undefined;
  if (user) {
    password = await editor.prompt("Password:");
  }

  const syncConfig: SyncEndpoint = {
    url,
    user,
    password,
  };

  try {
    await sync.check(syncConfig);
  } catch (e: any) {
    await editor.flashNotification(
      `Sync configuration failed: ${e.message}`,
      "error",
    );
    return;
  }

  await store.batchSet([
    { key: "sync.config", value: syncConfig },
    // Empty initial snapshot
    { key: "sync.snapshot", value: {} },
  ]);

  await editor.flashNotification("Sync configuration saved.");

  return syncConfig;
}

export async function syncCommand() {
  let config: SyncEndpoint | undefined = await store.get("sync.config");
  if (!config) {
    config = await configureCommand();
    if (!config) {
      return;
    }
  }
  await editor.flashNotification("Starting sync...");
  try {
    const operations = await system.invokeFunction("server", "performSync");
    await editor.flashNotification(
      `Sync complete. Performed ${operations} operations.`,
    );
  } catch (e: any) {
    await editor.flashNotification(
      `Sync failed: ${e.message}`,
      "error",
    );
  }
}

// Run on server
export async function performSync() {
  const config: SyncEndpoint = await store.get("sync.config");
  const snapshot = await store.get("sync.snapshot");
  const { snapshot: newSnapshot, operations, error } = await sync.sync(
    config,
    snapshot,
  );
  await store.set("sync.snapshot", newSnapshot);
  if (error) {
    console.error("Sync error", error);
    throw new Error(error);
  }
  return operations;
}
