import { hideRhs } from "plugos-silverbullet-syscall/editor";
import { invokeFunction } from "plugos-silverbullet-syscall/system";
import * as clientStore from "plugos-silverbullet-syscall/clientStore";

export async function togglePreview() {
  let currentValue = !!(await clientStore.get("enableMarkdownPreview"));
  await clientStore.set("enableMarkdownPreview", !currentValue);
  if (!currentValue) {
    await invokeFunction("client", "preview");
    // updateMarkdownPreview();
  } else {
    await hideMarkdownPreview();
  }
}

async function hideMarkdownPreview() {
  await hideRhs();
}
