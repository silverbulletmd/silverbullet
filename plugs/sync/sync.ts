import { store } from "$sb/plugos-syscall/mod.ts";
import {
  editor,
  index,
  space,
  sync,
  system,
} from "$sb/silverbullet-syscall/mod.ts";
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
    await system.invokeFunction("server", "check", syncConfig);
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
    await system.invokeFunction("server", "check", config);

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

export async function localWipeAndSyncCommand() {
  let config: SyncEndpoint | undefined = await store.get("sync.config");
  if (!config) {
    config = await configureCommand();
    if (!config) {
      return;
    }
  }

  if (
    !(await editor.confirm(
      "Are you sure you want to wipe your local space and sync with the remote?",
    ))
  ) {
    return;
  }

  if (
    !(await editor.confirm(
      "To be clear: this means all local content will be deleted with no way to recover it. Are you sure?",
    ))
  ) {
    return;
  }

  console.log("Wiping local pages");
  await editor.flashNotification("Now wiping all pages");
  for (const page of await space.listPages()) {
    console.log("Deleting page", page.name);
    await space.deletePage(page.name);
  }

  console.log("Wiping local attachments");
  await editor.flashNotification("Now wiping all attachments");
  for (const attachment of await space.listAttachments()) {
    console.log("Deleting attachment", attachment.name);
    await space.deleteAttachment(attachment.name);
  }

  console.log("Wiping local sync state");
  await store.set("sync.snapshot", {});

  // Starting actual sync
  await syncCommand();
}

// Run on server
export function check(config: SyncEndpoint) {
  return sync.check(config);
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
