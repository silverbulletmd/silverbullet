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

export async function reloadUICommand() {
  await editor.reloadUI();
}
