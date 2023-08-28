import { editor } from "$sb/syscalls.ts";
import { version } from "../../version.ts";

export async function versionCommand() {
  await editor.flashNotification(
    `You are currently running SilverBullet ${version}`,
  );
}

export async function gettingStartedCommand() {
  await editor.openUrl("https://silverbullet.md/Getting%20Started");
}
