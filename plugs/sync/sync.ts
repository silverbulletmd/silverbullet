import { editor, sync } from "@silverbulletmd/silverbullet/syscalls";

export async function syncSpaceCommand() {
  await editor.flashNotification("Syncing space...");
  await sync.performSpaceSync();
  await editor.flashNotification("Done.");
}
