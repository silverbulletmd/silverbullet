import { editor } from "$sb/silverbullet-syscall/mod.ts";
import { store } from "$sb/plugos-syscall/mod.ts";

// Run on "editor:init"
export async function setEditorMode() {
  if (await store.get("vimMode")) {
    await editor.setUiOption("vimMode", true);
  }
  if (await store.get("darkMode")) {
    await editor.setUiOption("darkMode", true);
  }
}

export async function toggleDarkMode() {
  let darkMode = await store.get("darkMode");
  darkMode = !darkMode;
  await editor.setUiOption("darkMode", darkMode);
  await store.set("darkMode", darkMode);
}
