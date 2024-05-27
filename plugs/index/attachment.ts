import { space } from "$sb/syscalls.ts";
import { AttachmentMeta, FileMeta } from "$sb/types.ts";
import { indexObjects } from "./api.ts";
import { plugPrefix } from "$common/spaces/constants.ts";

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
