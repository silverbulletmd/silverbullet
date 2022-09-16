import * as clientStore from "@silverbulletmd/plugos-silverbullet-syscall/clientStore";
import { enableReadOnlyMode } from "@silverbulletmd/plugos-silverbullet-syscall/editor";

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
