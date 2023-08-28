import { editor } from "$sb/syscalls.ts";

export async function accountLogoutCommand() {
  await editor.openUrl("/.client/logout.html", true);
}
