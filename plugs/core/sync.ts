import { editor, sync } from "$sb/silverbullet-syscall/mod.ts";

export async function syncSpaceCommand() {
  await editor.flashNotification("Syncing space...");
  await sync.scheduleSpaceSync();
  await editor.flashNotification("Done.");
}
