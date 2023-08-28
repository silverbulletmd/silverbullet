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

export async function toggleDarkMode() {
  let darkMode = await clientStore.get("darkMode");
  darkMode = !darkMode;
  await editor.setUiOption("darkMode", darkMode);
  await clientStore.set("darkMode", darkMode);
}

export async function foldCommand() {
  await editor.fold();
}

export async function unfoldCommand() {
  await editor.unfold();
}

export async function toggleFoldCommand() {
  await editor.toggleFold();
}

export async function foldAllCommand() {
  await editor.foldAll();
}

export async function unfoldAllCommand() {
  await editor.unfoldAll();
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
