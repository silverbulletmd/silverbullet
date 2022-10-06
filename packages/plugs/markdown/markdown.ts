import { hideLhs, hideRhs } from "../../plugos-silverbullet-syscall/editor.ts";
import { invokeFunction } from "../../plugos-silverbullet-syscall/system.ts";
import * as clientStore from "../../plugos-silverbullet-syscall/clientStore.ts";
import { readSettings } from "../lib/settings_page.ts";

export async function togglePreview() {
  let currentValue = !!(await clientStore.get("enableMarkdownPreview"));
  await clientStore.set("enableMarkdownPreview", !currentValue);
  if (!currentValue) {
    await invokeFunction("client", "preview");
  } else {
    await hideMarkdownPreview();
  }
}

async function hideMarkdownPreview() {
  const setting = await readSettings({ previewOnRHS: true });
  const hide = setting.previewOnRHS ? hideRhs : hideLhs;
  await hide();
}
