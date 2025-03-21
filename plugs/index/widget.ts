import { codeWidget } from "@silverbulletmd/silverbullet/syscalls";

export async function refreshWidgets() {
  await codeWidget.refreshAll();
}
