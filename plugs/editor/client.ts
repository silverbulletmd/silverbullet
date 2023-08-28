import { editor } from "$sb/syscalls.ts";

export async function setThinClient(def: any) {
  console.log("Setting thin client to", def.value);
  await editor.setUiOption("thinClientMode", def.value);
  await editor.reloadUI();
}
