import { index, space } from "@silverbulletmd/silverbullet/syscalls";
import type { DocumentMeta } from "@silverbulletmd/silverbullet/type/index";

// Note: clearFileIndex is not called but since this is the only document:index listener, this should be fine (famous last words)
export async function indexDocument(name: string) {
  // Markdown files are pages, indexed elsewhere; every other file is a document
  if (name.endsWith(".md")) {
    return;
  }

  const fileMeta = await space.getDocumentMeta(name);
  await index.indexObjects<DocumentMeta>(fileMeta.name, [fileMeta]);
}
