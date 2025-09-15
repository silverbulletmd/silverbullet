import * as pathUtils from "@std/path";
import { readAll } from "@std/io/read-all";
import type { SpacePrimitives } from "./space_primitives.ts";
import { mime } from "mimetypes";

import type { FileMeta } from "../../type/index.ts";
import { notFoundError } from "../constants.ts";

function lookupContentType(path: string): string {
  return mime.getType(path) || "application/octet-stream";
}

function normalizeForwardSlashPath(path: string) {
  return path.replaceAll("\\", "/");
}

export class DiskSpacePrimitives implements SpacePrimitives {
  rootPath: string;

  constructor(rootPath: string) {
    this.rootPath = Deno.realPathSync(rootPath);
  }

  safePath(p: string): string {
    const realPath = pathUtils.resolve(p);
    if (!realPath.startsWith(this.rootPath)) {
      throw Error(`Path ${p} is not in the space`);
    }
    return realPath;
  }

  filenameToPath(pageName: string) {
    return this.safePath(pathUtils.join(this.rootPath, pageName));
  }

  pathToFilename(fullPath: string): string {
    return fullPath.substring(this.rootPath.length + 1);
  }

  async readFile(
    path: string,
  ): Promise<{ data: Uint8Array; meta: FileMeta }> {
    const localPath = this.filenameToPath(path);
    try {
      const s = await Deno.stat(localPath);
      const contentType = lookupContentType(path);

      const f = await Deno.open(localPath, { read: true });
      const data = await readAll(f);
      f.close();

      return {
        data,
        meta: {
          name: path,
          created: s.birthtime?.getTime() || s.mtime?.getTime() || 0,
          lastModified: s.mtime?.getTime() || 0,
          perm: "rw",
          size: s.size,
          contentType: contentType,
        },
      };
    } catch {
      // console.error("Error while reading file", path, e);
      throw notFoundError;
    }
  }

  async writeFile(
    path: string,
    data: Uint8Array,
    meta?: FileMeta,
  ): Promise<FileMeta> {
    const localPath = this.filenameToPath(path);
    try {
      // Ensure parent folder exists
      await Deno.mkdir(pathUtils.dirname(localPath), { recursive: true });

      const file = await Deno.open(localPath, {
        write: true,
        create: true,
        truncate: true,
      });

      // Actually write the file
      const writer = file.writable.getWriter();
      await writer.write(data);

      if (meta?.lastModified) {
        // console.log("Seting mtime to", new Date(meta.lastModified));
        await file.utime(new Date(), new Date(meta.lastModified));
      }
      await writer.close();

      // Fetch new metadata
      return this.getFileMeta(path);
    } catch (e) {
      console.error("Error while writing file", path, e);
      throw Error(`Could not write ${path}`);
    }
  }

  async getFileMeta(path: string, _observing?: boolean): Promise<FileMeta> {
    const localPath = this.filenameToPath(path);
    try {
      return this.fileInfoToFileMeta(path, await Deno.stat(localPath));
    } catch (e: any) {
      if (e instanceof Deno.errors.NotFound) {
        throw notFoundError;
      }
      // console.error("Error while getting page meta", pageName, e);
      throw Error(`Could not get meta for ${path}`);
    }
  }

  private fileInfoToFileMeta(path: string, s: Deno.FileInfo): FileMeta {
    return {
      name: path,
      size: s.size,
      contentType: lookupContentType(path),
      created: s.birthtime?.getTime() || s.mtime?.getTime() || 0,
      lastModified: s.mtime?.getTime() || 0,
      perm: "rw",
    };
  }

  async deleteFile(path: string): Promise<void> {
    const localPath = this.filenameToPath(path);
    try {
      await Deno.remove(localPath);
    } catch (e: any) {
      if (e instanceof Deno.errors.NotFound) {
        throw notFoundError;
      }
      throw e;
    }

    // Recursively remove empty parent directories up to rootPath
    await this.cleanOrphaned(localPath);
  }

  private async cleanOrphaned(pathToDeletedFile: string) {
    let current = pathUtils.dirname(pathToDeletedFile);

    while (current.startsWith(this.rootPath) && current != this.rootPath) {
      try {
        // Attempt to remove the current directory
        await Deno.remove(current);
        current = pathUtils.dirname(current);
      } catch (e: any) {
        if (
          e.code === "ENOTEMPTY" ||
          e instanceof Deno.errors.PermissionDenied
        ) {
          break;
        }

        if (e instanceof Deno.errors.NotFound) {
          current = pathUtils.dirname(current); // continue upwards
          continue;
        }

        console.warn("Error cleaning orphaned folder", current, e);
        break;
      }
    }
  }

  fetchFileList(): Promise<FileMeta[]> {
    return this.getFileList();
  }

  private async getFileList(): Promise<FileMeta[]> {
    const allFiles: FileMeta[] = [];
    for await (const file of walkPreserveSymlinks(this.rootPath)) {
      // Uncomment to simulate a slow-ish disk
      // await new Promise((resolve) => setTimeout(resolve, 1));
      const fullPath = file.path;
      try {
        const s = await Deno.stat(fullPath);
        const name = fullPath.substring(this.rootPath.length + 1);
        allFiles.push(
          this.fileInfoToFileMeta(normalizeForwardSlashPath(name), s),
        );
      } catch (e: any) {
        if (e instanceof Deno.errors.NotFound) {
          // Ignore, temporariy file already deleted by the time we got here
        } else {
          console.error("Failed to stat", fullPath, e);
        }
      }
    }
    return allFiles;
  }
}

async function* walkPreserveSymlinks(
  dirPath: string,
): AsyncIterableIterator<{ path: string; entry: Deno.DirEntry }> {
  for await (const dirEntry of Deno.readDir(dirPath)) {
    const fullPath = `${dirPath}/${dirEntry.name}`;

    let entry: Deno.DirEntry | Deno.FileInfo = dirEntry;

    if (dirEntry.isSymlink) {
      try {
        entry = await Deno.stat(fullPath);
      } catch (e: any) {
        console.error("Error reading symlink", fullPath, e.message);
      }
    }

    if (entry.isFile) {
      yield { path: fullPath, entry: dirEntry };
    }

    if (entry.isDirectory) {
      // If it's a directory or a symlink, recurse into it
      yield* walkPreserveSymlinks(fullPath);
    }
  }
}
