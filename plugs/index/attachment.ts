import { space, system } from "$sb/syscalls.ts";
import { AttachmentMeta, FileMeta } from "$sb/types.ts";
import { indexObjects } from "./api.ts";
import { plugPrefix } from "$common/spaces/constants.ts";

export async function reindexAttachments() {
  if (await system.getMode() === "ro") {
    console.info("Not reindexing because we're in read-only mode");
    return;
  }
  const attachments = await space.listAttachments();
  for (const a of attachments) {
    await indexObjects<AttachmentMeta>(a.name, [a]);
  }
}

export async function indexAttachment(indexFile: string | FileMeta[]) {
  let fileNames = [];
  if (typeof indexFile === "string") {
    fileNames = [indexFile];
  } else {
    fileNames = indexFile.map((f) => f.name);
  }

  for (const name of fileNames) {
    if (!name.endsWith(".md") && !name.startsWith(plugPrefix)) {
      const fileMeta = await space.getAttachmentMeta(name);
      await indexObjects<AttachmentMeta>(fileMeta.name, [fileMeta]);
    }
  }
}
