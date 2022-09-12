import { AttachmentMeta, FileMeta, PageMeta } from "../types";
import { Plug } from "@plugos/plugos/plug";
import { FileData, FileEncoding, SpacePrimitives } from "./space_primitives";

export class HttpSpacePrimitives implements SpacePrimitives {
  fsUrl: string;
  private plugUrl: string;
  token?: string;

  constructor(url: string, token?: string) {
    this.fsUrl = url + "/fs";
    this.plugUrl = url + "/plug";
    this.token = token;
  }

  private async authenticatedFetch(
    url: string,
    options: any
  ): Promise<Response> {
    if (this.token) {
      options.headers = options.headers || {};
      options.headers["Authorization"] = `Bearer ${this.token}`;
    }
    let result = await fetch(url, options);
    if (result.status === 401) {
      throw Error("Unauthorized");
    }
    return result;
  }

  public async fetchFileList(): Promise<FileMeta[]> {
    let req = await this.authenticatedFetch(this.fsUrl, {
      method: "GET",
    });

    let result: FileMeta[] = await req.json();

    return result;
  }

  async readFile(
    name: string,
    encoding: FileEncoding
  ): Promise<{ data: FileData; meta: FileMeta }> {
    let res = await this.authenticatedFetch(`${this.fsUrl}/${name}`, {
      method: "GET",
    });
    if (res.status === 404) {
      throw new Error(`Page not found`);
    }
    let data: FileData | null = null;
    switch (encoding) {
      case "arraybuffer":
        let abBlob = await res.blob();
        data = await abBlob.arrayBuffer();
        break;
      case "dataurl":
        let dUBlob = await res.blob();
        data = arrayBufferToDataUrl(await dUBlob.arrayBuffer());
        break;
      case "string":
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
    selfUpdate?: boolean
  ): Promise<FileMeta> {
    let body: any = null;

    switch (encoding) {
      case "arraybuffer":
      case "string":
        body = data;
        break;
      case "dataurl":
        data = dataUrlToArrayBuffer(data as string);
        break;
    }
    let res = await this.authenticatedFetch(`${this.fsUrl}/${name}`, {
      method: "PUT",
      headers: {
        "Content-type": "application/octet-stream",
      },
      body,
    });
    const newMeta = this.responseToMeta(name, res);
    return newMeta;
  }

  async deleteFile(name: string): Promise<void> {
    let req = await this.authenticatedFetch(`${this.fsUrl}/${name}`, {
      method: "DELETE",
    });
    if (req.status !== 200) {
      throw Error(`Failed to delete file: ${req.statusText}`);
    }
  }

  async getFileMeta(name: string): Promise<FileMeta> {
    let res = await this.authenticatedFetch(`${this.fsUrl}/${name}`, {
      method: "OPTIONS",
    });
    if (res.status === 404) {
      throw new Error(`File not found`);
    }
    return this.responseToMeta(name, res);
  }

  private responseToMeta(name: string, res: Response): FileMeta {
    return {
      name,
      size: +res.headers.get("Content-length")!,
      contentType: res.headers.get("Content-type")!,
      lastModified: +(res.headers.get("Last-Modified") || "0"),
      perm: (res.headers.get("X-Permission") as "rw" | "ro") || "rw",
    };
  }

  // Plugs

  async proxySyscall(plug: Plug<any>, name: string, args: any[]): Promise<any> {
    let req = await this.authenticatedFetch(
      `${this.plugUrl}/${plug.name}/syscall/${name}`,
      {
        method: "POST",
        headers: {
          "Content-type": "application/json",
        },
        body: JSON.stringify(args),
      }
    );
    if (req.status !== 200) {
      let error = await req.text();
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
    args: any[]
  ): Promise<any> {
    // Invoke locally
    if (!env || env === "client") {
      return plug.invoke(name, args);
    }
    // Or dispatch to server
    let req = await this.authenticatedFetch(
      `${this.plugUrl}/${plug.name}/function/${name}`,
      {
        method: "POST",
        headers: {
          "Content-type": "application/json",
        },
        body: JSON.stringify(args),
      }
    );
    if (req.status !== 200) {
      let error = await req.text();
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

function dataUrlToArrayBuffer(dataUrl: string): ArrayBuffer {
  var binary_string = window.atob(dataUrl.split(",")[1]);
  var len = binary_string.length;
  var bytes = new Uint8Array(len);
  for (var i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes.buffer;
}

function arrayBufferToDataUrl(buffer: ArrayBuffer): string {
  var binary = "";
  var bytes = new Uint8Array(buffer);
  var len = bytes.byteLength;
  for (var i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return `data:application/octet-stream,${window.btoa(binary)}`;
}
