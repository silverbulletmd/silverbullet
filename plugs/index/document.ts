import { index, space } from "@silverbulletmd/silverbullet/syscalls";
import type { DocumentMeta } from "@silverbulletmd/silverbullet/type/index";

const nonDocumentFileExtensions = [".md", ".plug.js", ".js.map"];

// Note: clearFileIndex is not called but since this is the only document:index listener, this should be fine (famous last words)
export async function indexDocument(name: string) {
  // Check if path doesn't end with a non-document file extension
  if (nonDocumentFileExtensions.find((ext) => name.endsWith(ext))) {
    return;
  }

  const fileMeta = await space.getDocumentMeta(name);
  await index.indexObjects<DocumentMeta>(fileMeta.name, [fileMeta]);
}
