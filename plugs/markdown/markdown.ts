import { clientStore, editor, system } from "$sb/silverbullet-syscall/mod.ts";
import { readSettings } from "$sb/lib/settings_page.ts";

export async function togglePreview() {
  const currentValue = !!(await clientStore.get("enableMarkdownPreview"));
  await clientStore.set("enableMarkdownPreview", !currentValue);
  if (!currentValue) {
    await system.invokeFunction("client", "preview");
  } else {
    await hideMarkdownPreview();
  }
}

async function hideMarkdownPreview() {
  const setting = await readSettings({ previewOnRHS: true });
  const hide = setting.previewOnRHS ? editor.hideRhs : editor.hideLhs;
  await hide();
}
