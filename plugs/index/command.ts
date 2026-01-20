import { editor, index } from "@silverbulletmd/silverbullet/syscalls";

export async function reindexCommand() {
  await editor.flashNotification("Performing full page reindex...");
  await index.reindexSpace();
  await editor.flashNotification("Done with page index!");
}
