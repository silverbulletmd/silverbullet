import { clientStore, editor } from "@silverbulletmd/silverbullet/syscalls";

export async function toggleVimMode() {
  let vimMode = await clientStore.get("vimMode");
  vimMode = !vimMode;
  await editor.setUiOption("vimMode", vimMode);
  await clientStore.set("vimMode", vimMode);
}

export async function loadVimConfig() {
  const vimMode = await editor.getUiOption("vimMode");
  if (!vimMode) {
    console.log("Not in vim mode");
    return;
  }
  try {
    await editor.save();
    await editor.reloadConfigAndCommands();
    await editor.configureVimMode();
  } catch (e: any) {
    await editor.flashNotification(e.message, "error");
  }
}
