import { space, system } from "@silverbulletmd/silverbullet/syscalls";
import type { AttachmentMeta } from "@silverbulletmd/silverbullet/types";
import { indexObjects } from "./api.ts";

// Note: clearFileIndex is not called but since this is the only attachmet:index listener, this should be fine (famous last words)
export async function indexAttachment(name: string) {
  if (await system.getMode() === "ro") {
    return;
  }
  console.log("Indexing attachment", name);
  const fileMeta = await space.getAttachmentMeta(name);
  await indexObjects<AttachmentMeta>(fileMeta.name, [fileMeta]);
}
