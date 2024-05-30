import { space, system } from "$sb/syscalls.ts";
import { AttachmentMeta } from "$sb/types.ts";
import { indexObjects } from "./api.ts";

export async function indexAttachment(name: string) {
  if (await system.getMode() === "ro") {
    return;
  }
  const fileMeta = await space.getAttachmentMeta(name);
  await indexObjects<AttachmentMeta>(fileMeta.name, [fileMeta]);
}
