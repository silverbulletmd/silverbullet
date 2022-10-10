import * as clientStore from "../../syscall/silverbullet-syscall/clientStore.ts";
import { enableReadOnlyMode } from "../../syscall/silverbullet-syscall/editor.ts";

export async function editorLoad() {
  let readOnlyMode = await clientStore.get("readOnlyMode");
  if (readOnlyMode) {
    await enableReadOnlyMode(true);
  }
}

export async function toggleReadOnlyMode() {
  let readOnlyMode = await clientStore.get("readOnlyMode");
  readOnlyMode = !readOnlyMode;
  await enableReadOnlyMode(readOnlyMode);
  await clientStore.set("readOnlyMode", readOnlyMode);
}
