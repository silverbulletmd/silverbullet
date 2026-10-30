import { editor, mq } from "@silverbulletmd/silverbullet/syscalls";

/** Lets the index catch up, then picks up new scripts, commands and config. */
export async function reloadConfig(): Promise<void> {
  await mq.awaitEmptyQueue("indexQueue");
  await editor.reloadConfigAndCommands();
}
