import { editor } from "@silverbulletmd/silverbullet/syscalls";

export async function downloadCurrentFile(): Promise<void> {
  const name = await editor.getCurrentPath();
  try {
    await editor.downloadSpaceFile(name);
  } catch {
    await editor.flashNotification(`Could not download ${name}`, "error");
  }
}
