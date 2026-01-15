import {
  editor,
  markdown,
  mq,
  system,
} from "@silverbulletmd/silverbullet/syscalls";

export async function parsePageCommand() {
  console.log(
    "AST",
    JSON.stringify(
      await markdown.parseMarkdown(await editor.getText()),
      null,
      2,
    ),
  );
}

export async function wipeClientCommand() {
  if (
    !await editor.confirm(
      "Are you sure you want to wipe the client? This will clean the local cache.",
    )
  ) {
    return;
  }
  await system.wipeClient();
}

export async function wipeAndLogoutCommand() {
  await system.wipeClient(true);
}

/**
 * Does the following:
 * - Flushes all message queues
 * - Cleans IndexedDB databases not connected to the current space
 */
export async function cleanClientCommand() {
  await mq.flushAllQueues();
  if (await system.cleanDatabases()) {
    await editor.alert("Successfullly cleaned unnecessary client databases.");
  } else {
    await editor.alert("Failed to clean unnecessary client databases.");
  }
}

export async function reloadUICommand() {
  await editor.reloadUI();
}
