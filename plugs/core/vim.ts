import { readCodeBlockPage } from "../../plug-api/lib/yaml_page.ts";
import { editor } from "$sb/silverbullet-syscall/mod.ts";
import { store } from "$sb/plugos-syscall/mod.ts";

export async function toggleVimMode() {
  let vimMode = await store.get("vimMode");
  vimMode = !vimMode;
  await editor.setUiOption("vimMode", vimMode);
  await store.set("vimMode", vimMode);
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
  } catch (e: any) {
    // No VIMRC page found
  }
}
