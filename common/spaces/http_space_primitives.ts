import { FileMeta } from "../types.ts";
import { Plug } from "../../plugos/plug.ts";
import { FileData, FileEncoding, SpacePrimitives } from "./space_primitives.ts";
import {
  base64DecodeDataUrl,
  base64Encode,
  base64EncodedDataUrl,
} from "../../plugos/asset_bundle/base64.ts";
import { mime } from "../../plugos/deps.ts";

export class HttpSpacePrimitives implements SpacePrimitives {
  private fsUrl: string;
  private plugUrl: string;

  constructor(
    url: string,
    readonly user?: string,
    readonly password?: string,
    readonly base64Put?: boolean,
  ) {
    this.fsUrl = url + "/fs";
    this.plugUrl = url + "/plug";
  }

  private async authenticatedFetch(
    url: string,
    options: Record<string, any>,
  ): Promise<Response> {
    if (this.user && this.password) {
      // Explicitly set an auth cookie
      if (!options.headers) {
        options.headers = {};
      }
      options.headers["cookie"] = `auth=${
        btoa(`${this.user}:${this.password}`)
      }`;
    }
    const result = await fetch(url, options);
    if (result.status === 401 || result.redirected) {
      // Invalid credentials, reloading the browser should trigger authentication
      if (typeof location !== "undefined") {
        location.reload();
      }

      throw Error("Unauthorized");
    }
    return result;
  }

  async fetchFileList(): Promise<FileMeta[]> {
    const req = await this.authenticatedFetch(this.fsUrl, {
      method: "GET",
    });

    return req.json();
  }

  async readFile(
    name: string,
    encoding: FileEncoding,
  ): Promise<{ data: FileData; meta: FileMeta }> {
    const res = await this.authenticatedFetch(
      `${this.fsUrl}/${encodeURI(name)}`,
      {
        method: "GET",
      },
    );
    if (res.status === 404) {
      throw new Error(`Page not found`);
    }
    let data: FileData | null = null;
    switch (encoding) {
      case "arraybuffer":
        {
          data = await res.arrayBuffer();
        }
        break;
      case "dataurl":
        {
          data = base64EncodedDataUrl(
            mime.getType(name) || "application/octet-stream",
            new Uint8Array(await res.arrayBuffer()),
          );
        }
        break;
      case "utf8":
        data = await res.text();
        break;
    }
    return {
      data: data,
      meta: this.responseToMeta(name, res),
    };
  }

  async writeFile(
    name: string,
    encoding: FileEncoding,
    data: FileData,
  ): Promise<FileMeta> {
    let body: any = null;

    switch (encoding) {
      case "arraybuffer":
        // actually we want an Uint8Array
        body = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
        break;
      case "utf8":
        body = data;
        break;
      case "dataurl":
        data = base64DecodeDataUrl(data as string);
        break;
    }
    const headers: Record<string, string> = {
      "Content-Type": "application/octet-stream",
    };
    if (this.base64Put) {
      headers["X-Content-Base64"] = "true";
      headers["Content-Type"] = "text/plain";
      body = base64Encode(body);
    }

    const res = await this.authenticatedFetch(
      `${this.fsUrl}/${encodeURI(name)}`,
      {
        method: "PUT",
        headers,
        body,
      },
    );
    const newMeta = this.responseToMeta(name, res);
    return newMeta;
  }

  async deleteFile(name: string): Promise<void> {
    const req = await this.authenticatedFetch(
      `${this.fsUrl}/${encodeURI(name)}`,
      {
        method: "DELETE",
      },
    );
    if (req.status !== 200) {
      throw Error(`Failed to delete file: ${req.statusText}`);
    }
  }

  async getFileMeta(name: string): Promise<FileMeta> {
    const res = await this.authenticatedFetch(
      `${this.fsUrl}/${encodeURI(name)}`,
      {
        method: "OPTIONS",
      },
    );
    if (res.status === 404) {
      throw new Error(`File not found`);
    }
    return this.responseToMeta(name, res);
  }

  private responseToMeta(name: string, res: Response): FileMeta {
    return {
      name,
      size: +res.headers.get("X-Content-Length")!,
      contentType: res.headers.get("Content-type")!,
      lastModified: +(res.headers.get("X-Last-Modified") || "0"),
      perm: (res.headers.get("X-Permission") as "rw" | "ro") || "rw",
    };
  }

  // Plugs

  async proxySyscall(plug: Plug<any>, name: string, args: any[]): Promise<any> {
    const req = await this.authenticatedFetch(
      `${this.plugUrl}/${plug.name}/syscall/${name}`,
      {
        method: "POST",
        headers: {
          "Content-type": "application/json",
        },
        body: JSON.stringify(args),
      },
    );
    if (req.status !== 200) {
      const error = await req.text();
      throw Error(error);
    }
    if (req.headers.get("Content-length") === "0") {
      return;
    }
    return await req.json();
  }

  async invokeFunction(
    plug: Plug<any>,
    env: string,
    name: string,
    args: any[],
  ): Promise<any> {
    // Invoke locally
    if (!env || env === "client") {
      return plug.invoke(name, args);
    }
    // Or dispatch to server
    const req = await this.authenticatedFetch(
      `${this.plugUrl}/${plug.name}/function/${name}`,
      {
        method: "POST",
        headers: {
          "Content-type": "application/json",
        },
        body: JSON.stringify(args),
      },
    );
    if (req.status !== 200) {
      const error = await req.text();
      throw Error(error);
    }
    if (req.headers.get("Content-length") === "0") {
      return;
    }
    if (req.headers.get("Content-type")?.includes("application/json")) {
      return await req.json();
    } else {
      return await req.text();
    }
  }
}
