import { editor } from "$sb/silverbullet-syscall/mod.ts";

export async function syncSpaceCommand() {
  await editor.flashNotification("Syncing space...");
  await editor.syncSpace();
  await editor.flashNotification("Done.");
}
