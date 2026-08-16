import {
  clientStore,
  codeWidget,
  editor,
  system,
} from "@silverbulletmd/silverbullet/syscalls";

// Run on "editor:init"
export async function setEditorMode() {
  // TODO: Remove at some point: temporary upgrade code
  const allSyscalls = await system.listSyscalls();
  const queryLuaObjects = allSyscalls.find(
    (sc) => sc.name === "index.queryLuaObjects",
  );

  if (!queryLuaObjects) {
    await editor.alert(
      "Client needs reloading to update the cache, required syscalls are not available in this version. This message may appear a few times. Reloading now.",
    );
    void editor.reloadUI();
  }

  if (await clientStore.get("vimMode")) {
    await editor.setUiOption("vimMode", true);
  }
  // Only set the darkmode value if it was deliberatly set in the clientstore,
  // otherwise leave it so the client can choose depending on the system
  // settings
  const darkMode = await clientStore.get("darkMode");
  if (darkMode != null) {
    await editor.setUiOption("darkMode", darkMode);
  }
  const markdownSyntaxRendering = await clientStore.get(
    "markdownSyntaxRendering",
  );
  if (markdownSyntaxRendering != null) {
    await editor.setUiOption(
      "markdownSyntaxRendering",
      markdownSyntaxRendering,
    );
    await editor.rebuildEditorState();
  }
}

export async function openTagNavigator() {
  await editor.openNavigator("std.tags");
  // The panel focuses its own filter input; false keeps the client from
  // pulling focus straight back to the editor.
  return false;
}

export async function toggleDarkMode() {
  let darkMode = await editor.getUiOption("darkMode");
  darkMode = !darkMode;
  await clientStore.set("darkMode", darkMode);
  await editor.reloadUI();
}

export async function toggleMarkdownSyntaxRendering() {
  let renderingSyntax = await editor.getUiOption("markdownSyntaxRendering");
  renderingSyntax = !renderingSyntax;
  await clientStore.set("markdownSyntaxRendering", renderingSyntax);
  await editor.setUiOption("markdownSyntaxRendering", renderingSyntax);
  await editor.rebuildEditorState();
}

export async function centerCursorCommand() {
  const pos = await editor.getCursor();
  await editor.moveCursor(pos, true);
}

export async function moveToPosCommand() {
  let posString = await editor.prompt("Move to position:");
  if (posString === undefined) {
    return;
  }
  posString = posString.trim();
  if (posString === "") {
    void editor.flashNotification("Must provide a position.", "error");
    return;
  }
  const pos = +posString;
  await editor.moveCursor(pos, true);
}

export async function copyRefCommand() {
  const page = await editor.getCurrentPage();
  const pos = await editor.getCursor();
  await editor.copyToClipboard(`[[${page}@${pos}]]`);
  await editor.flashNotification("Ref copied to clipboard");
}

export async function copyLinkCommand() {
  const page = await editor.getCurrentPage();
  const pos = await editor.getCursor();
  await editor.copyToClipboard(`${await system.getBaseURI()}${page}@${pos}`);
  await editor.flashNotification("Link copied to clipboard");
}

export async function moveToLineCommand() {
  let lineString = await editor.prompt("Move to line (and optionally column):");
  if (lineString === undefined) {
    return;
  }
  lineString = lineString.trim();
  if (lineString === "") {
    void editor.flashNotification("Must provide a line number.", "error");
    return;
  }
  // Two capture groups: line number, then optional column number
  const numberRegex = /^(\d+)(?:[^\d]+(\d+))?/;
  const match = lineString.match(numberRegex);
  if (!match) {
    await editor.flashNotification(
      "Could not parse line number in prompt",
      "error",
    );
    return;
  }
  let column = 1;
  const line = parseInt(match[1], 10);
  if (match[2]) {
    column = parseInt(match[2], 10);
  }
  await editor.moveCursorToLine(line, column, true);
}

export async function customFlashMessage(_def: any, message: string) {
  await editor.flashNotification(message);
}

export async function reloadSystem() {
  await editor.save();
  await editor.reloadConfigAndCommands();
  await codeWidget.refreshAll();
  await editor.flashNotification("System and widgets reloaded!");
}
