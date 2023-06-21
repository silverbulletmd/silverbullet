import type { FileMeta } from "../types.ts";
import type { SpacePrimitives } from "./space_primitives.ts";
import Dexie, { Table } from "dexie";
import { mime } from "../deps.ts";

export type FileContent = {
  name: string;
  meta: FileMeta;
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
    const fileContent = await this.filesContentTable.get(name);
    if (!fileContent) {
      throw new Error("Not found");
    }

    return {
      data: fileContent.data,
      meta: fileContent.meta,
    };
  }

  async writeFile(
    name: string,
    data: Uint8Array,
    _selfUpdate?: boolean,
    suggestedMeta?: FileMeta,
  ): Promise<FileMeta> {
    const meta: FileMeta = {
      name,
      lastModified: suggestedMeta?.lastModified || Date.now(),
      contentType: mime.getType(name) || "application/octet-stream",
      size: data.byteLength,
      perm: suggestedMeta?.perm || "rw",
    };
    await this.filesContentTable.put({ name, data, meta });
    await this.filesMetaTable.put(meta);
    return meta;
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
