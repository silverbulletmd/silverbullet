import type { FileMeta } from "../types.ts";

// export type FileEncoding = "utf8" | "arraybuffer" | "dataurl";
// export type FileData = ArrayBuffer | string;

export interface SpacePrimitives {
  // Returns a list of file meta data as well as the timestamp of this snapshot
  fetchFileList(): Promise<FileMeta[]>;
  readFile(
    name: string,
  ): Promise<{ data: Uint8Array; meta: FileMeta }>;
  getFileMeta(name: string): Promise<FileMeta>;
  writeFile(
    name: string,
    data: Uint8Array,
    // Used to decide whether or not to emit change events
    selfUpdate?: boolean,
    lastModified?: number,
  ): Promise<FileMeta>;
  deleteFile(name: string): Promise<void>;
}
