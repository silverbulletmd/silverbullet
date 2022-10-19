// import { mkdir, readdir, readFile, stat, unlink, writeFile } from "fs/promises";
import { path } from "../deps.ts";
import { readAll } from "../deps.ts";
import { FileMeta } from "../types.ts";
import { FileData, FileEncoding, SpacePrimitives } from "./space_primitives.ts";
import { Plug } from "../../plugos/plug.ts";
import { mime } from "https://deno.land/x/mimetypes@v1.0.0/mod.ts";
import {
  base64DecodeDataUrl,
  base64EncodedDataUrl,
} from "../../plugos/asset_bundle/base64.ts";
import { walk } from "../../plugos/deps.ts";

function lookupContentType(path: string): string {
  return mime.getType(path) || "application/octet-stream";
}

export class DiskSpacePrimitives implements SpacePrimitives {
  rootPath: string;

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
    encoding: FileEncoding,
  ): Promise<{ data: FileData; meta: FileMeta }> {
    const localPath = this.filenameToPath(name);
    try {
      const s = await Deno.stat(localPath);
      let data: FileData | null = null;
      const contentType = lookupContentType(name);
      switch (encoding) {
        case "string":
          data = await Deno.readTextFile(localPath);
          break;
        case "dataurl":
          {
            const f = await Deno.open(localPath, { read: true });
            const buf = await readAll(f);
            Deno.close(f.rid);

            data = base64EncodedDataUrl(contentType, buf);
          }
          break;
        case "arraybuffer":
          {
            const f = await Deno.open(localPath, { read: true });
            const buf = await readAll(f);
            Deno.close(f.rid);

            data = buf.buffer;
          }
          break;
      }
      return {
        data,
        meta: {
          name: name,
          lastModified: s.mtime!.getTime(),
          perm: "rw",
          size: s.size,
          contentType: contentType,
        },
      };
    } catch {
      // console.error("Error while reading file", name, e);
      throw Error(`Could not read file ${name}`);
    }
  }

  async writeFile(
    name: string,
    encoding: FileEncoding,
    data: FileData,
  ): Promise<FileMeta> {
    const localPath = this.filenameToPath(name);
    try {
      // Ensure parent folder exists
      await Deno.mkdir(path.dirname(localPath), { recursive: true });

      // Actually write the file
      switch (encoding) {
        case "string":
          await Deno.writeTextFile(`${localPath}`, data as string);
          break;
        case "dataurl":
          await Deno.writeFile(
            localPath,
            base64DecodeDataUrl(data as string),
          );
          break;
        case "arraybuffer":
          await Deno.writeFile(localPath, new Uint8Array(data as ArrayBuffer));
          break;
      }

      // Fetch new metadata
      const s = await Deno.stat(localPath);
      return {
        name: name,
        size: s.size,
        contentType: lookupContentType(name),
        lastModified: s.mtime!.getTime(),
        perm: "rw",
      };
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
        lastModified: s.mtime!.getTime(),
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
  }

  async fetchFileList(): Promise<FileMeta[]> {
    const allFiles: FileMeta[] = [];
    for await (
      const file of walk(this.rootPath, {
        includeDirs: false,
        // Exclude hidden directories
        skip: [/^.*\/\..+$/],
      })
    ) {
      const fullPath = file.path;
      const s = await Deno.stat(fullPath);
      allFiles.push({
        name: fullPath.substring(this.rootPath.length + 1),
        lastModified: s.mtime!.getTime(),
        contentType: mime.getType(fullPath) || "application/octet-stream",
        size: s.size,
        perm: "rw",
      });
    }

    return allFiles;
  }

  // Plugs
  invokeFunction(
    plug: Plug<any>,
    _env: string,
    name: string,
    args: any[],
  ): Promise<any> {
    return plug.invoke(name, args);
  }

  proxySyscall(plug: Plug<any>, name: string, args: any[]): Promise<any> {
    return plug.syscall(name, args);
  }
}
