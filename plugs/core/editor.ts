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
