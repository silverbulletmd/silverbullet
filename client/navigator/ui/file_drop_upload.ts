import { isValidName, isValidPath } from "../../../plug-api/lib/ref.ts";
import { notFoundError } from "@silverbulletmd/silverbullet/constants";

export type DroppedFile = { path: string; file: File };

function validUploadPath(path: string): boolean {
  return isValidName(path) || isValidPath(path);
}

export async function uploadPathExists(
  getMeta: (path: string) => Promise<unknown>,
  path: string,
): Promise<boolean> {
  try {
    await getMeta(path);
    return true;
  } catch (error) {
    if (error instanceof Error && error.message === notFoundError.message)
      return false;
    throw error;
  }
}

export type UploadDependencies = {
  prompt: (message: string, initial: string) => Promise<string | undefined>;
  exists: (path: string) => Promise<boolean>;
  writePage: (name: string, content: string) => Promise<unknown>;
  writeDocument: (name: string, content: Uint8Array) => Promise<unknown>;
  notify: (message: string, type?: "error" | "info") => void;
  refresh: () => void;
  maxSizeBytes: number;
};

export async function collectDroppedFiles(
  transfer: DataTransfer,
): Promise<DroppedFile[]> {
  const items = [...transfer.items].filter((item) => item.kind === "file");
  const entries = items
    .map((item) => item.webkitGetAsEntry?.())
    .filter((entry): entry is FileSystemEntry => !!entry);
  if (entries.length !== items.length || entries.length === 0) {
    return [...transfer.files].map((file) => ({ path: file.name, file }));
  }
  const files: DroppedFile[] = [];
  async function visit(entry: FileSystemEntry, prefix: string): Promise<void> {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) =>
        (entry as FileSystemFileEntry).file(resolve, reject),
      );
      files.push({ path, file });
      return;
    }
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    while (true) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
        reader.readEntries(resolve, reject),
      );
      if (batch.length === 0) break;
      for (const child of batch) await visit(child, path);
    }
  }
  for (const entry of entries) await visit(entry, "");
  return files;
}

export async function uploadFiles(
  files: DroppedFile[],
  folder: string,
  dependencies: UploadDependencies,
): Promise<void> {
  const {
    prompt,
    exists,
    writePage,
    writeDocument,
    notify,
    refresh,
    maxSizeBytes,
  } = dependencies;
  if (files.length === 0) {
    notify("No files to upload", "info");
    return;
  }
  const destination = await prompt(
    `Upload ${files.length} file${files.length === 1 ? "" : "s"} to folder (empty for Space root)`,
    folder,
  );
  if (destination === undefined) return;
  const base = destination.trim();
  if (base && !validUploadPath(base)) {
    notify(`Invalid upload folder: ${base}`, "error");
    return;
  }
  const paths = new Set<string>();
  const planned: DroppedFile[] = [];
  for (const item of files) {
    let path = base ? `${base}/${item.path}` : item.path;
    if (!validUploadPath(path) || item.file.size > maxSizeBytes) {
      notify(`Invalid or oversized upload: ${item.path}`, "error");
      return;
    }
    while (await exists(path)) {
      const replacement = await prompt(
        `File exists. Keep path to replace, or enter a new path`,
        path,
      );
      if (replacement === undefined) return;
      const next = replacement.trim();
      if (!validUploadPath(next)) {
        notify(`Invalid upload path: ${next}`, "error");
        return;
      }
      if (next === path) break;
      path = next;
    }
    if (paths.has(path)) {
      notify(`Duplicate upload path: ${path}`, "error");
      return;
    }
    paths.add(path);
    planned.push({ ...item, path });
  }
  let uploaded = 0;
  let failed = 0;
  for (const item of planned) {
    try {
      if (item.path.endsWith(".md")) {
        const text = await item.file.text();
        await writePage(item.path.slice(0, -3), text);
      } else {
        await writeDocument(
          item.path,
          new Uint8Array(await item.file.arrayBuffer()),
        );
      }
      uploaded++;
    } catch (error) {
      failed++;
      notify(`Upload failed for ${item.path}: ${String(error)}`, "error");
    }
  }
  refresh();
  notify(
    `Uploaded ${uploaded} file${uploaded === 1 ? "" : "s"}${failed ? `; ${failed} failed` : ""}`,
    failed ? "error" : "info",
  );
}
