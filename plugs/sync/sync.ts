import {
  editor,
  index,
  space,
  sync,
} from "@silverbulletmd/silverbullet/syscalls";

let lastProgress = -1;
let lastProgressAt = 0;

const syncDisabledMessage =
  "Sync is disabled because the service worker is off";

async function requireSyncEnabled(): Promise<boolean> {
  if (await sync.isEnabled()) {
    return true;
  }
  await editor.flashNotification(syncDisabledMessage, "error");
  return false;
}

export async function syncSpaceCommand() {
  if (!(await requireSyncEnabled())) {
    return;
  }
  await editor.flashNotification("Syncing space...");
  await sync.performSpaceSync();
  await editor.flashNotification("Done.");
}

export async function syncFileCommand() {
  if (!(await requireSyncEnabled())) {
    return;
  }
  await editor.flashNotification("Syncing file...");
  await sync.performFileSync(await editor.getCurrentPath());
  await editor.flashNotification("Done.");
}

export async function spaceSyncComplete(message: { operations: number }) {
  if (message.operations > 0) {
    await space.listFiles();
  }

  void index.ensureFullIndex();
}

export async function fileSyncComplete(message: {
  path: string;
  operations: number;
}) {
  if (message.operations > 0) {
    // Re-read the specific file's metadata to trigger file:changed event
    await space.getFileMeta(message.path);
  }
}

export async function updateSyncStatus(event: {
  status: {
    filesProcessed: number;
    totalFiles: number;
  };
}) {
  const percentage = Math.round(
    (event.status.filesProcessed / event.status.totalFiles) * 100,
  );
  if (percentage >= 99) {
    await editor.hideProgress("sync");
    lastProgressAt = 0;
  } else {
    const now = Date.now();
    if (lastProgress !== percentage || now - lastProgressAt >= 1000) {
      lastProgress = percentage;
      lastProgressAt = now;
      await editor.showProgress("sync", percentage);
    }
  }
}
