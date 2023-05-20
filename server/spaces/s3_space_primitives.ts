import { S3Client } from "../fork/deno-s3-lite-client/mod.ts";
import type { ClientOptions } from "../fork/deno-s3-lite-client/client.ts";
import {
  FileData,
  FileEncoding,
  SpacePrimitives,
} from "../../common/spaces/space_primitives.ts";
import { FileMeta } from "../../common/types.ts";
import {
  base64DecodeDataUrl,
  base64EncodedDataUrl,
} from "../../plugos/asset_bundle/base64.ts";
import { mime } from "../deps.ts";

export class S3SpacePrimitives implements SpacePrimitives {
  client: S3Client;
  constructor(options: ClientOptions) {
    this.client = new S3Client(options);
  }

  private encodePath(name: string): string {
    // return btoa(name);
    return name;
  }

  private decodePath(encoded: string): string {
    // AWS only returns ' replace dwith &apos;
    return encoded.replaceAll("&apos;", "'");
  }

  async fetchFileList(): Promise<FileMeta[]> {
    const allFiles: FileMeta[] = [];

    for await (const obj of this.client.listObjects({ prefix: "" })) {
      allFiles.push({
        name: this.decodePath(obj.key),
        perm: "rw",
        lastModified: obj.lastModified.getTime(),
        contentType: mime.getType(obj.key) || "application/octet-stream",
        size: obj.size,
      });
    }
    return allFiles;
  }

  async readFile(
    name: string,
    encoding: FileEncoding,
  ): Promise<{ data: FileData; meta: FileMeta }> {
    try {
      //   console.log("Fetching object", encodeURI(name));
      const obj = await this.client.getObject(this.encodePath(name));

      const contentType = obj.headers.get("Content-Type") ||
        "application/octet-stream";
      const meta: FileMeta = {
        name,
        perm: "rw",
        lastModified: new Date(obj.headers.get("Last-Modified")!).getTime(),
        contentType,
        size: parseInt(obj.headers.get("Content-Length")!),
      };
      switch (encoding) {
        case "utf8":
          return {
            data: await obj.text(),
            meta,
          };
        case "dataurl":
          return {
            data: base64EncodedDataUrl(
              contentType,
              new Uint8Array(await obj.arrayBuffer()),
            ),
            meta,
          };
        case "arraybuffer":
          return {
            data: new Uint8Array(await obj.arrayBuffer()),
            meta,
          };
      }
    } catch (e: any) {
      console.log("GOt error", e.message);
      if (e.message.includes("does not exist")) {
        throw new Error(`Not found`);
      }
      throw e;
    }
  }
  async getFileMeta(name: string): Promise<FileMeta> {
    try {
      const stat = await this.client.statObject(this.encodePath(name));
      return {
        name,
        perm: "rw",
        lastModified: new Date(stat.lastModified).getTime(),
        size: stat.size,
        contentType: mime.getType(name) || "application/octet-stream",
      };
    } catch (e: any) {
      if (e.message.includes("404")) {
        throw new Error(`Not found`);
      }
      throw e;
    }
  }
  async writeFile(
    name: string,
    encoding: FileEncoding,
    data: FileData,
  ): Promise<FileMeta> {
    let content: Uint8Array | undefined;
    switch (encoding) {
      case "arraybuffer":
        // actually we want an Uint8Array
        content = new Uint8Array(data as ArrayBuffer);
        break;
      case "utf8":
        content = new TextEncoder().encode(data as string);
        break;
      case "dataurl":
        content = base64DecodeDataUrl(data as string);
        break;
    }
    console.log("Key", this.encodePath(name));
    await this.client.putObject(this.encodePath(name), content);
    // TODO: Dangerous due to eventual consistency? maybe check with etag or versionid?
    return this.getFileMeta(name);
  }
  async deleteFile(name: string): Promise<void> {
    await this.client.deleteObject(this.encodePath(name));
  }
}
