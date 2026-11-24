import {
  folderNotEmptyError,
  notFoundError,
} from "@silverbulletmd/silverbullet/constants";
import type { FileMeta } from "@silverbulletmd/silverbullet/type/index";
import mime from "mime";
import type { KvPrimitives } from "../data/kv_primitives.ts";
import type { SpaceListing, SpacePrimitives } from "./space_primitives.ts";

const filesMetaPrefix = ["meta"];
const filesContentPrefix = ["content"];
// One entry per folder, so folders outlive the files in them. Folders
// implied by file paths written before these entries existed are derived
// from the file list instead.
const foldersPrefix = ["folder"];

/** "a/b/c.md" -> ["a", "a/b"] */
function parentFolders(path: string): string[] {
  const parts = path.split("/");
  return parts.slice(1).map((_, i) => parts.slice(0, i + 1).join("/"));
}

export class DataStoreSpacePrimitives implements SpacePrimitives {
  constructor(private kv: KvPrimitives) {}

  async fetchFileList(): Promise<FileMeta[]> {
    const fileMetas: FileMeta[] = [];
    for await (const meta of this.kv.query({ prefix: filesMetaPrefix })) {
      fileMetas.push(this.cleanFileMeta(meta.value as FileMeta));
    }
    return fileMetas;
  }

  async readFile(path: string): Promise<{ data: Uint8Array; meta: FileMeta }> {
    const [fileMeta, fileContent] = await this.kv.batchGet([
      [...filesMetaPrefix, path],
      [...filesContentPrefix, path],
    ]);
    if (!fileMeta) {
      throw notFoundError;
    }

    return {
      meta: this.cleanFileMeta(fileMeta),
      data: fileContent,
    };
  }

  async writeFile(
    path: string,
    data: Uint8Array,
    suggestedMeta?: FileMeta,
  ): Promise<FileMeta> {
    let meta: FileMeta | undefined;
    try {
      meta = await this.getFileMeta(path);
    } catch {
      // Not found, that's fine
    }
    if (!meta) {
      meta = {
        name: path,
        created: suggestedMeta?.created || Date.now(),
        perm: "rw",
        contentType: mime.getType(path) || "application/octet-stream",
        lastModified: 0,
        size: 0,
      };
    }
    meta.lastModified = suggestedMeta?.lastModified || Date.now();
    meta.size = data.byteLength;
    if (suggestedMeta?.perm) {
      meta.perm = suggestedMeta.perm;
    }

    // Write metadata, content and parent folders in same transaction
    await this.kv.batchSet([
      {
        key: [...filesMetaPrefix, path],
        value: meta,
      },
      {
        key: [...filesContentPrefix, path],
        value: data,
      },
      ...parentFolders(path).map((folder) => ({
        key: [...foldersPrefix, folder],
        value: true,
      })),
    ]);
    return meta;
  }

  async deleteFile(path: string): Promise<void> {
    const [fileMeta] = await this.kv.batchGet([[...filesMetaPrefix, path]]);
    if (!fileMeta) {
      throw notFoundError;
    }
    return this.kv.batchDelete([
      [...filesMetaPrefix, path],
      [...filesContentPrefix, path],
    ]);
  }

  async getFileMeta(
    path: string,
    _observing?: boolean,
    _mode?: "cheap",
  ): Promise<FileMeta> {
    const [fileMeta] = await this.kv.batchGet([[...filesMetaPrefix, path]]);
    if (!fileMeta) {
      throw notFoundError;
    }
    return this.cleanFileMeta(fileMeta);
  }

  async fetchListing(): Promise<SpaceListing> {
    const files = await this.fetchFileList();
    const folders = new Set<string>();
    for await (const { key } of this.kv.query({ prefix: foldersPrefix })) {
      folders.add(key[1] as string);
    }
    for (const { name } of files) {
      for (const folder of parentFolders(name)) {
        folders.add(folder);
      }
    }
    return { files, folders: [...folders] };
  }

  async createFolder(path: string): Promise<void> {
    await this.kv.batchSet(
      [...parentFolders(path), path].map((folder) => ({
        key: [...foldersPrefix, folder],
        value: true,
      })),
    );
  }

  async deleteFolder(
    path: string,
    opts?: { recursive?: boolean },
  ): Promise<void> {
    const { files, folders = [] } = await this.fetchListing();
    if (!folders.includes(path)) {
      throw notFoundError;
    }
    const prefix = `${path}/`;
    const innerFiles = files.filter(({ name }) => name.startsWith(prefix));
    const innerFolders = folders.filter((folder) => folder.startsWith(prefix));
    if (!opts?.recursive && (innerFiles.length || innerFolders.length)) {
      throw folderNotEmptyError;
    }
    // One batch, so it's all gone or none of it is
    await this.kv.batchDelete([
      ...innerFiles.flatMap(({ name }) => [
        [...filesMetaPrefix, name],
        [...filesContentPrefix, name],
      ]),
      ...[path, ...innerFolders].map((folder) => [...foldersPrefix, folder]),
    ]);
  }

  cleanFileMeta(fileMeta: FileMeta): FileMeta {
    if (!fileMeta.created) {
      fileMeta.created = fileMeta.lastModified;
    }
    return fileMeta;
  }
}
