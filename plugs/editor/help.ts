import { editor } from "@silverbulletmd/silverbullet/syscalls";
import { publicVersion } from "../../version.ts";

export async function versionCommand() {
  await editor.flashNotification(
    `You are currently running SilverBullet ${publicVersion}`,
  );
}
