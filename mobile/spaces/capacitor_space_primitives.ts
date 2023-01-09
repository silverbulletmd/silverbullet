import {
  FileData,
  FileEncoding,
  SpacePrimitives,
} from "../../common/spaces/space_primitives.ts";
import type { FileMeta } from "../../common/types.ts";
import {
  base64Decode,
  base64Encode,
} from "../../plugos/asset_bundle/base64.ts";
import type { Plug } from "../../plugos/plug.ts";
import { Directory, Encoding, Filesystem } from "../deps.ts";
import { mime } from "../../plugos/deps.ts";

// Stores timestamps (specifically lastModified timestamps) for files for
// spaces that don't natively support it (like Capacitor's FS API)
export interface TimestampStorage {
  get(name: string): Promise<number | null>;
  set(name: string, value: number): Promise<void>;
}

// Trivial in memory timestamp storage, only useful for testing
export class InMemoryTimestampStore implements TimestampStorage {
  private timestamps: Record<string, number> = {};

  get(name: string): Promise<number | null> {
    return Promise.resolve(this.timestamps[name] || null);
  }
  set(name: string, value: number): Promise<void> {
    this.timestamps[name] = value;
    return Promise.resolve();
  }
}

export class CapacitorSpacePrimitives implements SpacePrimitives {
  constructor(
    readonly source: Directory,
    readonly root: string,
    readonly timestampStorage: TimestampStorage,
  ) {
  }

  async fetchFileList(): Promise<{ files: FileMeta[]; timestamp: number }> {
    const allFiles: FileMeta[] = [];
    const directory = this.source;
    const root = this.root;
    const timestampStorage = this.timestampStorage;

    async function readAllFiles(dir: string) {
      const files = await Filesystem.readdir({
        path: `${root}/${dir}`,
        directory,
      });
      for (const file of files.files) {
        if (file.type === "file") {
          const name = `${dir}/${file.name}`.substring(1);
          allFiles.push({
            name: name,
            lastModified: await timestampStorage.get(name) || file.mtime,
            perm: "rw",
            contentType: mime.getType(file.name) || "application/octet-stream",
            size: file.size,
          });
        } else { // Directory
          await readAllFiles(`${dir}/${file.name}`);
        }
      }
    }
    await readAllFiles("");
    return {
      files: allFiles,
      timestamp: Date.now(),
    };
  }
  async readFile(
    name: string,
    encoding: FileEncoding,
  ): Promise<{ data: FileData; meta: FileMeta }> {
    let data: FileData | undefined;
    try {
      switch (encoding) {
        case "string":
          data = (await Filesystem.readFile({
            path: this.root + name,
            directory: this.source,
            encoding: Encoding.UTF8,
          })).data;
          break;
        case "arraybuffer": {
          const b64Data = (await Filesystem.readFile({
            path: this.root + name,
            directory: this.source,
          })).data;
          data = base64Decode(b64Data);
          break;
        }
        case "dataurl": {
          const b64Data = (await Filesystem.readFile({
            path: this.root + name,
            directory: this.source,
          })).data;
          data = `data:${
            mime.getType(name) || "application/octet-stream"
          };base64,${b64Data}`;
          break;
        }
      }
      return {
        data: data!,
        meta: await this.getFileMeta(name),
      };
    } catch {
      throw new Error(`Page not found`);
    }
  }
  async getFileMeta(name: string): Promise<FileMeta> {
    try {
      const statResult = await Filesystem.stat({
        path: this.root + name,
        directory: this.source,
      });
      return {
        name,
        contentType: mime.getType(name) || "application/octet-stream",
        lastModified: await this.timestampStorage.get(name) || statResult.mtime,
        perm: "rw",
        size: statResult.size,
      };
    } catch (e: any) {
      console.error("Error getting file meta", e.message);
      throw new Error(`Page not found`);
    }
  }
  async writeFile(
    name: string,
    encoding: FileEncoding,
    data: FileData,
    selfUpdate?: boolean,
    timestamp?: number,
  ): Promise<FileMeta> {
    switch (encoding) {
      case "string":
        await Filesystem.writeFile({
          path: this.root + name,
          directory: this.source,
          encoding: Encoding.UTF8,
          data: data as string,
          recursive: true,
        });
        break;
      case "arraybuffer":
        await Filesystem.writeFile({
          path: this.root + name,
          directory: this.source,
          data: base64Encode(new Uint8Array(data as ArrayBuffer)),
          recursive: true,
        });
        break;
      case "dataurl":
        await Filesystem.writeFile({
          path: this.root + name,
          directory: this.source,
          data: (data as string).split(";base64,")[1],
          recursive: true,
        });
        break;
    }
    if (timestamp) {
      await this.timestampStorage.set(name, timestamp);
    }
    return this.getFileMeta(name);
  }

  async deleteFile(name: string): Promise<void> {
    await Filesystem.deleteFile({
      path: this.root + name,
      directory: this.source,
    });
  }
  proxySyscall(plug: Plug<any>, name: string, args: any[]): Promise<any> {
    return plug.syscall(name, args);
  }
  invokeFunction(
    plug: Plug<any>,
    _env: string,
    name: string,
    args: any[],
  ): Promise<any> {
    return plug.invoke(name, args);
  }
}
