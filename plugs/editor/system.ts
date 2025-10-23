import {
  editor,
  markdown,
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

export async function cleanClientCommand() {
  if (await system.cleanDatabases()) {
    await editor.alert("Successfullly cleaned unnecessary client databases.");
  } else {
    await editor.alert("Failed to clean unnecessary client databases.");
  }
}

export async function reloadUICommand() {
  await editor.reloadUI();
}
