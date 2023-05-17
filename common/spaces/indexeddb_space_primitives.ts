import type { FileMeta } from "../types.ts";
import type { Plug } from "../../plugos/plug.ts";
import type {
  FileData,
  FileEncoding,
  SpacePrimitives,
} from "./space_primitives.ts";
import {
  base64DecodeDataUrl,
  base64EncodedDataUrl,
} from "../../plugos/asset_bundle/base64.ts";
import Dexie, { Table } from "dexie";
import { mime } from "../deps.ts";

export type FileContent = {
  name: string;
  data: Uint8Array;
};

export class IndexedDBSpacePrimitives implements SpacePrimitives {
  private db: Dexie;
  filesMetaTable: Table<FileMeta, string>;
  filesContentTable: Table<FileContent, string>;

  constructor(
    dbName: string,
    indexedDB?: any,
  ) {
    this.db = new Dexie(dbName, {
      indexedDB,
    });
    this.db.version(1).stores({
      fileMeta: "name",
      fileContent: "name",
    });
    this.filesMetaTable = this.db.table("fileMeta");
    this.filesContentTable = this.db.table<FileContent, string>("fileContent");
  }

  fetchFileList(): Promise<FileMeta[]> {
    return this.filesMetaTable.toArray();
  }

  async readFile(
    name: string,
    encoding: FileEncoding,
  ): Promise<{ data: FileData; meta: FileMeta }> {
    const fileMeta = await this.filesMetaTable.get(name);
    if (!fileMeta) {
      throw new Error("Not found");
    }
    const fileContent = await this.filesContentTable.get(name);
    if (!fileContent) {
      throw new Error("Not found");
    }
    let data: FileData | undefined;
    switch (encoding) {
      case "arraybuffer":
        {
          data = fileContent.data.buffer;
        }
        break;
      case "dataurl":
        {
          data = base64EncodedDataUrl(
            mime.getType(name) || "application/octet-stream",
            fileContent.data,
          );
        }
        break;
      case "utf8":
        data = new TextDecoder().decode(fileContent.data);
        break;
    }
    return {
      data: data,
      meta: fileMeta,
    };
  }

  async writeFile(
    name: string,
    encoding: FileEncoding,
    data: FileData,
    _selfUpdate?: boolean,
    lastModified?: number,
  ): Promise<FileMeta> {
    let content: ArrayBuffer | undefined;

    switch (encoding) {
      case "arraybuffer":
        // actually we want an Uint8Array
        content = data as ArrayBuffer;
        break;
      case "utf8":
        content = new TextEncoder().encode(data as string);
        break;
      case "dataurl":
        content = base64DecodeDataUrl(data as string);
        break;
    }

    const fileMeta: FileMeta = {
      name,
      lastModified: lastModified || Date.now(),
      contentType: mime.getType(name) || "application/octet-stream",
      size: content.byteLength,
      perm: "rw",
    };
    await this.filesContentTable.put({
      name,
      data: new Uint8Array(content),
    });
    await this.filesMetaTable.put(fileMeta);
    return fileMeta;
  }

  async deleteFile(name: string): Promise<void> {
    const fileMeta = await this.filesMetaTable.get(name);
    if (!fileMeta) {
      throw new Error("Not found");
    }
    await this.filesMetaTable.delete(name);
    await this.filesContentTable.delete(name);
  }

  async getFileMeta(name: string): Promise<FileMeta> {
    const fileMeta = await this.filesMetaTable.get(name);
    if (!fileMeta) {
      throw new Error("Not found");
    }
    return fileMeta;
  }
}
