import type { SpacePrimitives } from "./space_primitives.ts";
import mime from "mime";
import type { FileMeta } from "@silverbulletmd/silverbullet/type/index";
import { notFoundError } from "@silverbulletmd/silverbullet/constants";

export type FsFile = {
  name: string;
  size: number;
  lastModified: number;
  arrayBuffer(): Promise<ArrayBuffer>;
};

export type FsWritableStream = {
  write(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
};

export type FsFileHandle = {
  kind: "file";
  name: string;
  getFile(): Promise<FsFile>;
  createWritable(): Promise<FsWritableStream>;
};

export type FsDirHandle = {
  kind: "directory";
  name: string;
  values(): AsyncIterable<FsFileHandle | FsDirHandle>;
  getFileHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<FsFileHandle>;
  getDirectoryHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<FsDirHandle>;
  removeEntry(name: string): Promise<void>;
  queryPermission?: (options?: {
    mode?: "read" | "readwrite";
  }) => Promise<PermissionState>;
  requestPermission?: (options?: {
    mode?: "read" | "readwrite";
  }) => Promise<PermissionState>;
};

export class FileSystemAccessSpacePrimitives implements SpacePrimitives {
  constructor(private root: FsDirHandle) {}

  async fetchFileList(): Promise<FileMeta[]> {
    const metas: FileMeta[] = [];
    const walk = async (dir: FsDirHandle, prefix: string) => {
      for await (const entry of dir.values()) {
        const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.kind === "directory") {
          await walk(entry, path);
        } else {
          const file = await entry.getFile();
          metas.push(this.fileToMeta(path, file));
        }
      }
    };
    await walk(this.root, "");
    return metas;
  }

  async getFileMeta(path: string, _observing?: boolean): Promise<FileMeta> {
    const { parent, name } = await this.navigate(path, false);
    let handle: FsFileHandle;
    try {
      handle = await parent.getFileHandle(name);
    } catch {
      throw notFoundError;
    }
    const file = await handle.getFile();
    return this.fileToMeta(path, file);
  }

  async readFile(path: string): Promise<{ data: Uint8Array; meta: FileMeta }> {
    const { parent, name } = await this.navigate(path, false);
    let handle: FsFileHandle;
    try {
      handle = await parent.getFileHandle(name);
    } catch {
      throw notFoundError;
    }
    const file = await handle.getFile();
    const buf = await file.arrayBuffer();
    return { data: new Uint8Array(buf), meta: this.fileToMeta(path, file) };
  }

  async writeFile(
    path: string,
    data: Uint8Array,
    _suggestedMeta?: FileMeta,
  ): Promise<FileMeta> {
    const { parent, name } = await this.navigate(path, true);
    const handle = await parent.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    await writable.write(data);
    await writable.close();
    const file = await handle.getFile();
    return this.fileToMeta(path, file);
  }

  async deleteFile(path: string): Promise<void> {
    const { parent, name } = await this.navigate(path, false);
    try {
      await parent.removeEntry(name);
    } catch {
      throw notFoundError;
    }
  }

  private fileToMeta(path: string, file: FsFile): FileMeta {
    return {
      name: path,
      created: file.lastModified,
      lastModified: file.lastModified,
      contentType: mime.getType(path) || "application/octet-stream",
      size: file.size,
      perm: "rw",
    };
  }

  private async navigate(
    path: string,
    create: boolean,
  ): Promise<{ parent: FsDirHandle; name: string }> {
    const parts = path.split("/").filter(Boolean);
    if (parts.length === 0) {
      throw notFoundError;
    }
    const name = parts[parts.length - 1];
    let dir = this.root;
    for (let i = 0; i < parts.length - 1; i++) {
      try {
        dir = await dir.getDirectoryHandle(parts[i], { create });
      } catch {
        throw notFoundError;
      }
    }
    return { parent: dir, name };
  }
}
