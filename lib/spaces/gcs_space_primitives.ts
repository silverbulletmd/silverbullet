import * as gcs from "googleapis-storage";
import {auth, ADCResponse, Storage } from "googleapis-storage";
import {SpacePrimitives} from "./space_primitives.ts";
import {FileMeta} from "@silverbulletmd/silverbullet/type/index";


export class GCSSpacePrimitives implements SpacePrimitives {

  private bucket: Bucket;
  private storage: Storage;
  private prefix: string;

  constructor(bucket: string, prefix: string|undefined) {
    this.bucket = bucket;
    this.prefix = (prefix || "").replace(/^\/+|\/+$/g, "");
    const adc: ADCResponse = await auth.getApplicationDefault();
    this.storage = new Storage(adc);
  }

  deleteFile(name: string): Promise<void> {
    return Promise.resolve(undefined);
  }

  fetchFileList(): Promise<FileMeta[]> {
    return Promise.resolve([]);
  }

  getFileMeta(name: string): Promise<FileMeta> {
    return Promise.resolve(undefined);
  }

  readFile(name: string): Promise<{ data: Uint8Array; meta: FileMeta }> {
    return Promise.resolve({data: undefined, meta: undefined});
  }

  writeFile(name: string, data: Uint8Array, selfUpdate?: boolean, meta?: FileMeta): Promise<FileMeta> {
    return Promise.resolve(undefined);
  }
}