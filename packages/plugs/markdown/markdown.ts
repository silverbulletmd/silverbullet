import { hideRhs, hideLhs } from "@silverbulletmd/plugos-silverbullet-syscall/editor";
import { invokeFunction } from "@silverbulletmd/plugos-silverbullet-syscall/system";
import * as clientStore from "@silverbulletmd/plugos-silverbullet-syscall/clientStore";
import { readSettings, writeSettings } from "@silverbulletmd/plugs/lib/settings_page";;


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
  const setting = await readSettings({previewOnRHS: true});
  const hide = setting.previewOnRHS ? hideRhs : hideLhs;
  await hide();
}
