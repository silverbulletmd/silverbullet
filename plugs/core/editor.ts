import { clientStore, editor } from "$sb/silverbullet-syscall/mod.ts";

export async function editorLoad() {
  const readOnlyMode = await clientStore.get("readOnlyMode");
  if (readOnlyMode) {
    await editor.enableReadOnlyMode(true);
  }
}

export async function toggleReadOnlyMode() {
  let readOnlyMode = await clientStore.get("readOnlyMode");
  readOnlyMode = !readOnlyMode;
  await editor.enableReadOnlyMode(readOnlyMode);
  await clientStore.set("readOnlyMode", readOnlyMode);
}

// Run on "editor:init"
export async function setEditorMode() {
  if (await clientStore.get("vimMode")) {
    await editor.setUiOption("vimMode", true);
  }
  if (await clientStore.get("darkMode")) {
    await editor.setUiOption("darkMode", true);
  }
}

export async function toggleVimMode() {
  let vimMode = await clientStore.get("vimMode");
  vimMode = !vimMode;
  await editor.setUiOption("vimMode", vimMode);
  await clientStore.set("vimMode", vimMode);
}

export async function toggleDarkMode() {
  let darkMode = await clientStore.get("darkMode");
  darkMode = !darkMode;
  await editor.setUiOption("darkMode", darkMode);
  await clientStore.set("darkMode", darkMode);
}
