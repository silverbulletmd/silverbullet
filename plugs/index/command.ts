import { editor } from "@silverbulletmd/silverbullet/syscalls";
import { reindexSpace } from "./queue.ts";

export async function reindexCommand() {
  await editor.flashNotification("Performing full page reindex...");
  await reindexSpace();
  await editor.flashNotification("Done with page index!");
}
