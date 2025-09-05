import type { Object } from "googleapis-storage";
import type { SpacePrimitives } from "./space_primitives.ts";
import type { FileMeta } from "@silverbulletmd/silverbullet/type/index";
import * as gcsClient from "./gcs_client.ts";

export class GCSSpacePrimitives implements SpacePrimitives {
  private bucketName: string;
  private prefix: string;

  constructor(bucket: string, prefix: string | undefined) {
    this.bucketName = bucket;
    this.prefix = (prefix || "").replace(/^\/+|\/+$/g, "");
  }

  async deleteFile(name: string): Promise<void> {
    await gcsClient.deleteFile(
      this.bucketName,
      `${this.prefix}/${name}`,
    );
  }

  async fetchFileList(): Promise<FileMeta[]> {
    const fileMetas: FileMeta[] = await gcsClient.listFiles(
      this.bucketName,
      this.prefix,
    );
    return fileMetas;
  }

  async getFileMeta(name: string): Promise<FileMeta> {
    const meta = await gcsClient.readFileMetadata(
      this.bucketName,
      `${this.prefix}/${name}`,
    );
    return meta;
  }

  async readFile(name: string): Promise<{ data: Uint8Array; meta: FileMeta }> {
    const [meta, data] = await Promise.all([
      gcsClient.readFileMetadata(this.bucketName, `${this.prefix}/${name}`),
      gcsClient.readFileData(this.bucketName, `${this.prefix}/${name}`),
    ]);
    return { data, meta };
  }

  async writeFile(
    name: string,
    data: Uint8Array,
    _selfUpdate?: boolean,
    meta?: FileMeta,
  ): Promise<FileMeta> {
    const object: Object = await gcsClient.uploadFile(
      this.bucketName,
      this.prefix ? `${this.prefix}/${name}` : name,
      data,
    );
    return {
      name: object.name!,
      created: new Date(object.timeCreated!).getTime(),
      lastModified: new Date(object.updated!).getTime(),
      contentType: object.contentType!,
      size: Number(object.size!),
      perm: "rw",
      noSync: meta?.noSync,
    } as FileMeta;
  }
}
