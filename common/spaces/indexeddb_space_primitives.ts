import type { FileMeta } from "../types.ts";
import type { SpacePrimitives } from "./space_primitives.ts";
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
  ): Promise<{ data: Uint8Array; meta: FileMeta }> {
    const fileMeta = await this.filesMetaTable.get(name);
    if (!fileMeta) {
      throw new Error("Not found");
    }
    const fileContent = await this.filesContentTable.get(name);
    if (!fileContent) {
      throw new Error("Not found");
    }

    return {
      data: fileContent.data,
      meta: fileMeta,
    };
  }

  async writeFile(
    name: string,
    data: Uint8Array,
    _selfUpdate?: boolean,
    lastModified?: number,
  ): Promise<FileMeta> {
    const fileMeta: FileMeta = {
      name,
      lastModified: lastModified || Date.now(),
      contentType: mime.getType(name) || "application/octet-stream",
      size: data.byteLength,
      perm: "rw",
    };
    await this.filesContentTable.put({ name, data });
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
