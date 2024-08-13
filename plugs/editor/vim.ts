import { readCodeBlockPage } from "@silverbulletmd/silverbullet/lib/yaml_page";
import { clientStore, editor } from "@silverbulletmd/silverbullet/syscalls";

export async function toggleVimMode() {
  let vimMode = await clientStore.get("vimMode");
  vimMode = !vimMode;
  await editor.setUiOption("vimMode", vimMode);
  await clientStore.set("vimMode", vimMode);
}

export async function loadVimRc() {
  const vimMode = await editor.getUiOption("vimMode");
  if (!vimMode) {
    console.log("Not in vim mode");
    return;
  }
  try {
    const vimRc = await readCodeBlockPage("VIMRC");
    if (vimRc) {
      console.log("Now running vim ex commands from VIMRC");
      const lines = vimRc.split("\n");
      for (const line of lines) {
        try {
          console.log("Running vim ex command", line);
          await editor.vimEx(line);
        } catch (e: any) {
          await editor.flashNotification(e.message, "error");
        }
      }
    }
  } catch {
    // No VIMRC page found
  }
}
