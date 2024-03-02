import { clientStore, editor } from "$sb/syscalls.ts";

// Run on "editor:init"
export async function setEditorMode() {
  if (await clientStore.get("vimMode")) {
    await editor.setUiOption("vimMode", true);
  }
  if (await clientStore.get("darkMode")) {
    await editor.setUiOption("darkMode", true);
  }
}

export function openCommandPalette() {
  return editor.openCommandPalette();
}

export async function openPageNavigator() {
  await editor.openPageNavigator("page");
}

export async function openTemplateNavigator() {
  await editor.openPageNavigator("template");
}

export async function toggleDarkMode() {
  let darkMode = await clientStore.get("darkMode");
  darkMode = !darkMode;
  await clientStore.set("darkMode", darkMode);
  await editor.reloadUI();
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
  await editor.moveCursor(pos);
}

export async function customFlashMessage(_def: any, message: string) {
  await editor.flashNotification(message);
}

export async function reloadSystem() {
  await editor.reloadSettingsAndCommands();
  await editor.flashNotification("Reloaded system");
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
