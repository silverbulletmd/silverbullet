import { editor, system } from "@silverbulletmd/silverbullet/syscalls";

export async function versionCommand() {
  await editor.flashNotification(
    `You are currently running SilverBullet ${await system.getVersion()}`,
  );
}
