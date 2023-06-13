import { editor } from "$sb/silverbullet-syscall/mod.ts";

export async function accountLogoutCommand() {
  await editor.openUrl("/.client/logout.html", true);
}
