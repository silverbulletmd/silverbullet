// We're explicitly using 0.4.0 to be able to hijack the path encoding, which is inconsisently broken in 0.5.0
import { S3Client } from "https://deno.land/x/s3_lite_client@0.4.0/mod.ts";
import type { ClientOptions } from "https://deno.land/x/s3_lite_client@0.4.0/client.ts";
import { SpacePrimitives } from "../../common/spaces/space_primitives.ts";
import { FileMeta } from "../../common/types.ts";
import { mime } from "../deps.ts";

export class S3SpacePrimitives implements SpacePrimitives {
  client: S3Client;
  constructor(options: ClientOptions) {
    this.client = new S3Client(options);
  }

  private encodePath(name: string): string {
    return uriEscapePath(name);
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
  ): Promise<{ data: Uint8Array; meta: FileMeta }> {
    try {
      //   console.log("Fetching object", encodeURI(name));
      const obj = await this.client.getObject(this.encodePath(name));

      const contentType = mime.getType(name) || "application/octet-stream";
      const meta: FileMeta = {
        name,
        perm: "rw",
        lastModified: new Date(obj.headers.get("Last-Modified")!).getTime(),
        contentType,
        size: parseInt(obj.headers.get("Content-Length")!),
      };

      return {
        data: new Uint8Array(await obj.arrayBuffer()),
        meta,
      };
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
    data: Uint8Array,
  ): Promise<FileMeta> {
    if (data.byteLength === 0) {
      // S3 doesn't like empty files, so we'll put a space in it. Not ideal, but it works. I hope.
      data = new TextEncoder().encode(" ");
    }
    await this.client.putObject(this.encodePath(name), data);
    // TODO: Dangerous due to eventual consistency? maybe check with etag or versionid?
    return this.getFileMeta(name);
  }
  async deleteFile(name: string): Promise<void> {
    await this.client.deleteObject(this.encodePath(name));
  }
}

// Stolen from https://github.com/aws/aws-sdk-js/blob/master/lib/util.js

export function uriEscapePath(string: string): string {
  return string.split("/").map(uriEscape).join("/");
}

function uriEscape(string: string): string {
  let output = encodeURIComponent(string);
  output = output.replace(/[^A-Za-z0-9_.~\-%]+/g, escape);

  // AWS percent-encodes some extra non-standard characters in a URI
  output = output.replace(/[*]/g, function (ch) {
    return "%" + ch.charCodeAt(0).toString(16).toUpperCase();
  });

  return output;
}
