import { mkdir, readdir, readFile, stat, unlink, writeFile } from "fs/promises";
import * as path from "path";
import { FileMeta } from "../types";
import { FileData, FileEncoding, SpacePrimitives } from "./space_primitives";
import { Plug } from "@plugos/plugos/plug";
import { realpathSync } from "fs";
import mime from "mime-types";

function lookupContentType(path: string): string {
  return mime.lookup(path) || "application/octet-stream";
}

export class DiskSpacePrimitives implements SpacePrimitives {
  rootPath: string;

  constructor(rootPath: string) {
    this.rootPath = realpathSync(rootPath);
  }

  safePath(p: string): string {
    let realPath = path.resolve(p);
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
    encoding: FileEncoding
  ): Promise<{ data: FileData; meta: FileMeta }> {
    const localPath = this.filenameToPath(name);
    try {
      const s = await stat(localPath);
      let data: FileData | null = null;
      let contentType = lookupContentType(name);
      switch (encoding) {
        case "string":
          data = await readFile(localPath, "utf8");
          break;
        case "dataurl":
          let fileBuffer = await readFile(localPath, {
            encoding: "base64",
          });
          data = `data:${contentType};base64,${fileBuffer}`;
          break;
        case "arraybuffer":
          let arrayBuffer = await readFile(localPath);
          data = arrayBuffer.buffer;
          break;
      }
      return {
        data,
        meta: {
          name: name,
          lastModified: s.mtime.getTime(),
          perm: "rw",
          size: s.size,
          contentType: contentType,
        },
      };
    } catch (e) {
      console.error("Error while reading file", name, e);
      throw Error(`Could not read file ${name}`);
    }
  }

  async writeFile(
    name: string,
    encoding: FileEncoding,
    data: FileData,
    selfUpdate?: boolean
  ): Promise<FileMeta> {
    let localPath = this.filenameToPath(name);
    try {
      // Ensure parent folder exists
      await mkdir(path.dirname(localPath), { recursive: true });

      // Actually write the file
      switch (encoding) {
        case "string":
          await writeFile(localPath, data as string, "utf8");
          break;
        case "dataurl":
          await writeFile(localPath, (data as string).split(",")[1], {
            encoding: "base64",
          });
          break;
        case "arraybuffer":
          await writeFile(localPath, Buffer.from(data as ArrayBuffer));
          break;
      }

      // Fetch new metadata
      const s = await stat(localPath);
      return {
        name: name,
        size: s.size,
        contentType: lookupContentType(name),
        lastModified: s.mtime.getTime(),
        perm: "rw",
      };
    } catch (e) {
      console.error("Error while writing file", name, e);
      throw Error(`Could not write ${name}`);
    }
  }

  async getFileMeta(name: string): Promise<FileMeta> {
    let localPath = this.filenameToPath(name);
    try {
      const s = await stat(localPath);
      return {
        name: name,
        size: s.size,
        contentType: lookupContentType(name),
        lastModified: s.mtime.getTime(),
        perm: "rw",
      };
    } catch (e) {
      // console.error("Error while getting page meta", pageName, e);
      throw Error(`Could not get meta for ${name}`);
    }
  }

  async deleteFile(name: string): Promise<void> {
    let localPath = this.filenameToPath(name);
    await unlink(localPath);
  }

  async fetchFileList(): Promise<FileMeta[]> {
    let fileList: FileMeta[] = [];

    const walkPath = async (dir: string) => {
      let files = await readdir(dir);
      for (let file of files) {
        if (file.startsWith(".")) {
          continue;
        }
        const fullPath = path.join(dir, file);
        let s = await stat(fullPath);
        if (s.isDirectory()) {
          await walkPath(fullPath);
        } else {
          if (!file.startsWith(".")) {
            fileList.push({
              name: this.pathToFilename(fullPath),
              size: s.size,
              contentType: lookupContentType(fullPath),
              lastModified: s.mtime.getTime(),
              perm: "rw",
            });
          }
        }
      }
    };
    await walkPath(this.rootPath);
    return fileList;
  }

  // Plugs
  invokeFunction(
    plug: Plug<any>,
    env: string,
    name: string,
    args: any[]
  ): Promise<any> {
    return plug.invoke(name, args);
  }

  proxySyscall(plug: Plug<any>, name: string, args: any[]): Promise<any> {
    return plug.syscall(name, args);
  }
}
