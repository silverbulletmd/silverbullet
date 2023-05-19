import type { FileMeta } from "../types.ts";

export type FileEncoding = "utf8" | "arraybuffer" | "dataurl";
export type FileData = ArrayBuffer | string;

export interface SpacePrimitives {
  // Returns a list of file meta data as well as the timestamp of this snapshot
  fetchFileList(): Promise<FileMeta[]>;
  readFile(
    name: string,
    encoding: FileEncoding,
  ): Promise<{ data: FileData; meta: FileMeta }>;
  getFileMeta(name: string): Promise<FileMeta>;
  writeFile(
    name: string,
    encoding: FileEncoding,
    data: FileData,
    // Used to decide whether or not to emit change events
    selfUpdate?: boolean,
    lastModified?: number,
  ): Promise<FileMeta>;
  deleteFile(name: string): Promise<void>;
}
