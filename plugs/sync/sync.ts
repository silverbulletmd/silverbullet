import {
  editor,
  index,
  space,
  sync,
} from "@silverbulletmd/silverbullet/syscalls";

export async function syncSpaceCommand() {
  await editor.flashNotification("Syncing space...");
  await sync.performSpaceSync();
  await editor.flashNotification("Done.");
}

export async function syncFileCommand() {
  await editor.flashNotification("Syncing file...");
  await sync.performFileSync(await editor.getCurrentPath());
  await editor.flashNotification("Done.");
}

export async function spaceSyncComplete(message: { operations: number }) {
  if (message.operations > 0) {
    // Update the page list
    await space.listFiles();
  }

  index.ensureFullIndex();
}

export async function updateSyncStatus(
  event: {
    status: {
      filesProcessed: number;
      totalFiles: number;
    };
  },
) {
  // Update the status in the UI
  await editor.showProgress(
    Math.round((event.status.filesProcessed / event.status.totalFiles) * 100),
    "sync",
  );
}

export async function reportSyncConflict({ path }: { path: string }) {
  await editor.flashNotification(
    `Sync: conflict detected for ${path} - conflict copy created`,
    "error",
  );
}
