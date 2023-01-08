import { Plug } from "../../plugos/plug.ts";
import { FileMeta } from "../types.ts";

export type FileEncoding = "string" | "arraybuffer" | "dataurl";
export type FileData = ArrayBuffer | string;
export interface SpacePrimitives {
  // Pages
  fetchFileList(): Promise<{ files: FileMeta[]; timestamp: number }>;
  readFile(
    name: string,
    encoding: FileEncoding,
  ): Promise<{ data: FileData; meta: FileMeta }>;
  getFileMeta(name: string): Promise<FileMeta>;
  writeFile(
    name: string,
    encoding: FileEncoding,
    data: FileData,
    selfUpdate?: boolean,
    timestamp?: number,
  ): Promise<FileMeta>;
  deleteFile(name: string, timestamp?: number): Promise<void>;

  // Plugs
  proxySyscall(plug: Plug<any>, name: string, args: any[]): Promise<any>;
  invokeFunction(
    plug: Plug<any>,
    env: string,
    name: string,
    args: any[],
  ): Promise<any>;
}
