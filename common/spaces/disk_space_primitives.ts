import * as path from "@std/path";
import { readAll } from "@std/io/read-all";
import type { SpacePrimitives } from "./space_primitives.ts";
import { mime } from "mimetypes";
import type { FileMeta } from "../../plug-api/types.ts";

function lookupContentType(path: string): string {
  return mime.getType(path) || "application/octet-stream";
}

function normalizeForwardSlashPath(path: string) {
  return path.replaceAll("\\", "/");
}

const excludedFiles = ["data.db", "data.db-journal", "sync.json"];

export class DiskSpacePrimitives implements SpacePrimitives {
  rootPath: string;
  fileListCache: FileMeta[] = [];
  fileListCacheTime = 0;
  fileListCacheUpdating: AbortController | null = null;

  constructor(rootPath: string) {
    this.rootPath = Deno.realPathSync(rootPath);
  }

  safePath(p: string): string {
    const realPath = path.resolve(p);
    if (!realPath.startsWith(this.rootPath)) {
      throw Error(`Path ${p} is not in the space`);
    }
    return realPath;
  }

  filenameToPath(pageName: string) {
    return this.safePath(path.join(this.rootPath, pageName));
  }

  pathToFilename(fullPath: string): string {
    return fullPath.substring(this.rootPath.length + 1);
  }

  async readFile(
    name: string,
  ): Promise<{ data: Uint8Array; meta: FileMeta }> {
    const localPath = this.filenameToPath(name);
    try {
      const s = await Deno.stat(localPath);
      const contentType = lookupContentType(name);

      const f = await Deno.open(localPath, { read: true });
      const data = await readAll(f);
      f.close();

      return {
        data,
        meta: {
          name: name,
          created: s.birthtime?.getTime() || s.mtime?.getTime() || 0,
          lastModified: s.mtime?.getTime() || 0,
          perm: "rw",
          size: s.size,
          contentType: contentType,
        },
      };
    } catch {
      // console.error("Error while reading file", name, e);
      throw Error("Not found");
    }
  }

  async writeFile(
    name: string,
    data: Uint8Array,
    _selfUpdate?: boolean,
    meta?: FileMeta,
  ): Promise<FileMeta> {
    const localPath = this.filenameToPath(name);
    try {
      // Ensure parent folder exists
      await Deno.mkdir(path.dirname(localPath), { recursive: true });

      const file = await Deno.open(localPath, {
        write: true,
        create: true,
        truncate: true,
      });

      // Actually write the file
      await file.write(data);

      if (meta?.lastModified) {
        // console.log("Seting mtime to", new Date(meta.lastModified));
        await file.utime(new Date(), new Date(meta.lastModified));
      }
      file.close();

      // Invalidate cache and trigger an update
      this.fileListCache = [];
      this.fileListCacheTime = 0;
      this.updateCacheInBackground();

      // Fetch new metadata
      return this.getFileMeta(name);
    } catch (e) {
      console.error("Error while writing file", name, e);
      throw Error(`Could not write ${name}`);
    }
  }

  async getFileMeta(name: string): Promise<FileMeta> {
    const localPath = this.filenameToPath(name);
    try {
      const s = await Deno.stat(localPath);
      return {
        name: name,
        size: s.size,
        contentType: lookupContentType(name),
        created: s.birthtime?.getTime() || s.mtime?.getTime() || 0,
        lastModified: s.mtime?.getTime() || 0,
        perm: "rw",
      };
    } catch {
      // console.error("Error while getting page meta", pageName, e);
      throw Error(`Could not get meta for ${name}`);
    }
  }

  async deleteFile(name: string): Promise<void> {
    const localPath = this.filenameToPath(name);
    await Deno.remove(localPath);

    // Invalidate cache and trigger an update
    this.fileListCache = [];
    this.fileListCacheTime = 0;
    this.updateCacheInBackground();
  }

  async fetchFileList(): Promise<FileMeta[]> {
    // console.log("Fetching file list");
    const startTime = performance.now();

    // If the file list cache is less than 60 seconds old, return it
    if (
      this.fileListCache.length > 0 &&
      startTime - this.fileListCacheTime < 60000
    ) {
      // Trigger a background sync, but return the cached list while the cache is being updated
      this.updateCacheInBackground();
      return this.fileListCache;
    }

    // Otherwise get the file list and wait for it
    const allFiles: FileMeta[] = await this.getFileList();

    const endTime = performance.now();
    console.info("Fetched uncached file list in", endTime - startTime, "ms");

    this.fileListCache = allFiles;
    this.fileListCacheTime = startTime;

    return allFiles;
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
        if (excludedFiles.includes(name)) {
          continue;
        }
        allFiles.push({
          name: normalizeForwardSlashPath(name),
          created: s.birthtime?.getTime() || s.mtime?.getTime() || 0,
          lastModified: s.mtime?.getTime() || 0,
          contentType: mime.getType(fullPath) || "application/octet-stream",
          size: s.size,
          perm: "rw",
        });
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

  private updateCacheInBackground() {
    if (this.fileListCacheUpdating) {
      // Cancel the existing background update, so we never return stale data
      this.fileListCacheUpdating.abort();
    }

    const abortController = new AbortController();
    this.fileListCacheUpdating = abortController;

    const updatePromise = this.getFileList().then((allFiles) => {
      if (abortController.signal.aborted) return;

      this.fileListCache = allFiles;
      this.fileListCacheTime = performance.now();
      // console.info(
      //   "Updated file list cache in background:",
      //   allFiles.length,
      //   "files found",
      // );
    }).catch((error) => {
      if (abortController.signal.aborted) return;

      if (error.name !== "AbortError") {
        console.error("Error updating file list cache in background:", error);
      }
    }).finally(() => {
      if (this.fileListCacheUpdating === abortController) {
        this.fileListCacheUpdating = null;
      }
    });

    return updatePromise;
  }
}

async function* walkPreserveSymlinks(
  dirPath: string,
): AsyncIterableIterator<{ path: string; entry: Deno.DirEntry }> {
  for await (const dirEntry of Deno.readDir(dirPath)) {
    const fullPath = `${dirPath}/${dirEntry.name}`;
    if (dirEntry.name.startsWith(".")) {
      // Skip hidden files and folders
      continue;
    }

    let entry: Deno.DirEntry | Deno.FileInfo = dirEntry;

    if (dirEntry.isSymlink) {
      try {
        entry = await Deno.stat(fullPath);
      } catch (e) {
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
