import { editor, sync } from "@silverbulletmd/silverbullet/syscalls";

export async function syncSpaceCommand() {
  await editor.flashNotification("Syncing space...");
  await sync.scheduleSpaceSync();
  await editor.flashNotification("Done.");
}
