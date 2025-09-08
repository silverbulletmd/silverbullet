import {
  clientStore,
  codeWidget,
  editor,
} from "@silverbulletmd/silverbullet/syscalls";

// Run on "editor:init"
export async function setEditorMode() {
  if (await clientStore.get("vimMode")) {
    await editor.setUiOption("vimMode", true);
  }
  if (await clientStore.get("darkMode")) {
    await editor.setUiOption("darkMode", true);
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

export function openCommandPalette() {
  return editor.openCommandPalette();
}

export async function openPageNavigator() {
  await editor.openPageNavigator("page");
}

export async function openMetaNavigator() {
  await editor.openPageNavigator("meta");
}

export async function openDocumentNavigator() {
  await editor.openPageNavigator("document");
}

export async function openAllNavigator() {
  await editor.openPageNavigator("all");
}

export async function toggleDarkMode() {
  let darkMode = await editor.getUiOption("darkMode");
  darkMode = !darkMode;
  await clientStore.set("darkMode", darkMode);
  await editor.reloadUI();
}

export async function toggleMarkdownSyntaxRendering() {
  let renderingSyntax = await editor.getUiOption(
    "markdownSyntaxRendering",
  );
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
  const posString = await editor.prompt("Move to position:");
  if (!posString) {
    return;
  }
  const pos = +posString;
  await editor.moveCursor(pos, true); // showing the movement for better UX
}

export async function moveToLineCommand() {
  const lineString = await editor.prompt(
    "Move to line (and optionally column):",
  );
  if (!lineString) {
    return;
  }
  // Match sequence of digits at the start, optionally another sequence
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
  const line = parseInt(match[1]);
  if (match[2]) {
    column = parseInt(match[2]);
  }
  await editor.moveCursorToLine(line, column, true); // showing the movement for better UX
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

export function refreshAllWidgets() {
  codeWidget.refreshAll();
}

export async function findInPageCommand() {
  await editor.openSearchPanel();
  return false;
}

export function undoCommand() {
  return editor.undo();
}

export function redoCommand() {
  return editor.redo();
}

export function deleteLineCommand() {
  return editor.deleteLine();
}

export function newWindowCommand() {
  return editor.newWindow();
}
