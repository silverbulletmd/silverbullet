import { AttachmentMeta, PageMeta } from "../types";
import { Plug } from "@plugos/plugos/plug";
import {
  AttachmentData,
  AttachmentEncoding,
  SpacePrimitives,
} from "./space_primitives";

export class HttpSpacePrimitives implements SpacePrimitives {
  fsUrl: string;
  fsaUrl: string;
  private plugUrl: string;
  token?: string;

  constructor(url: string, token?: string) {
    this.fsUrl = url + "/page";
    this.fsaUrl = url + "/attachment";
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

  public async fetchPageList(): Promise<{
    pages: Set<PageMeta>;
    nowTimestamp: number;
  }> {
    let req = await this.authenticatedFetch(this.fsUrl, {
      method: "GET",
    });

    let result = new Set<PageMeta>();
    ((await req.json()) as any[]).forEach((meta: any) => {
      const pageName = meta.name;
      result.add({
        name: pageName,
        lastModified: meta.lastModified,
        perm: "rw",
      });
    });

    return {
      pages: result,
      nowTimestamp: +req.headers.get("Now-Timestamp")!,
    };
  }

  async readPage(name: string): Promise<{ text: string; meta: PageMeta }> {
    let res = await this.authenticatedFetch(`${this.fsUrl}/${name}`, {
      method: "GET",
    });
    if (res.headers.get("X-Status") === "404") {
      throw new Error(`Page not found`);
    }
    return {
      text: await res.text(),
      meta: this.responseToPageMeta(name, res),
    };
  }

  async writePage(
    name: string,
    text: string,
    selfUpdate?: boolean,
    lastModified?: number
  ): Promise<PageMeta> {
    // TODO: lastModified ignored for now
    let res = await this.authenticatedFetch(`${this.fsUrl}/${name}`, {
      method: "PUT",
      body: text,
      headers: lastModified
        ? {
            "Last-Modified": "" + lastModified,
          }
        : undefined,
    });
    const newMeta = this.responseToPageMeta(name, res);
    return newMeta;
  }

  async deletePage(name: string): Promise<void> {
    let req = await this.authenticatedFetch(`${this.fsUrl}/${name}`, {
      method: "DELETE",
    });
    if (req.status !== 200) {
      throw Error(`Failed to delete page: ${req.statusText}`);
    }
  }

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

  // Attachments
  public async fetchAttachmentList(): Promise<{
    attachments: Set<AttachmentMeta>;
    nowTimestamp: number;
  }> {
    let req = await this.authenticatedFetch(this.fsaUrl, {
      method: "GET",
    });

    let result = new Set<AttachmentMeta>();
    ((await req.json()) as any[]).forEach((meta: any) => {
      const pageName = meta.name;
      result.add({
        name: pageName,
        size: meta.size,
        lastModified: meta.lastModified,
        contentType: meta.contentType,
        perm: "rw",
      });
    });

    return {
      attachments: result,
      nowTimestamp: +req.headers.get("Now-Timestamp")!,
    };
  }

  async readAttachment(
    name: string,
    encoding: AttachmentEncoding
  ): Promise<{ data: AttachmentData; meta: AttachmentMeta }> {
    let res = await this.authenticatedFetch(`${this.fsaUrl}/${name}`, {
      method: "GET",
    });
    if (res.headers.get("X-Status") === "404") {
      throw new Error(`Page not found`);
    }
    let blob = await res.blob();
    return {
      data:
        encoding === "arraybuffer"
          ? await blob.arrayBuffer()
          : arrayBufferToDataUrl(await blob.arrayBuffer()),
      meta: this.responseToAttachmentMeta(name, res),
    };
  }

  async writeAttachment(
    name: string,
    data: AttachmentData,
    selfUpdate?: boolean,
    lastModified?: number
  ): Promise<AttachmentMeta> {
    if (typeof data === "string") {
      data = dataUrlToArrayBuffer(data);
    }
    let res = await this.authenticatedFetch(`${this.fsaUrl}/${name}`, {
      method: "PUT",
      body: data,
      headers: {
        "Last-Modified": lastModified ? "" + lastModified : undefined,
        "Content-type": "application/octet-stream",
      },
    });
    const newMeta = this.responseToAttachmentMeta(name, res);
    return newMeta;
  }

  async getAttachmentMeta(name: string): Promise<AttachmentMeta> {
    let res = await this.authenticatedFetch(`${this.fsaUrl}/${name}`, {
      method: "OPTIONS",
    });
    if (res.headers.get("X-Status") === "404") {
      throw new Error(`Page not found`);
    }
    return this.responseToAttachmentMeta(name, res);
  }

  async deleteAttachment(name: string): Promise<void> {
    let req = await this.authenticatedFetch(`${this.fsaUrl}/${name}`, {
      method: "DELETE",
    });
    if (req.status !== 200) {
      throw Error(`Failed to delete attachment: ${req.statusText}`);
    }
  }

  // Plugs

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

  async getPageMeta(name: string): Promise<PageMeta> {
    let res = await this.authenticatedFetch(`${this.fsUrl}/${name}`, {
      method: "OPTIONS",
    });
    if (res.headers.get("X-Status") === "404") {
      throw new Error(`Page not found`);
    }
    return this.responseToPageMeta(name, res);
  }

  private responseToPageMeta(name: string, res: Response): PageMeta {
    return {
      name,
      lastModified: +(res.headers.get("Last-Modified") || "0"),
      perm: (res.headers.get("X-Permission") as "rw" | "ro") || "rw",
    };
  }

  private responseToAttachmentMeta(
    name: string,
    res: Response
  ): AttachmentMeta {
    return {
      name,
      lastModified: +(res.headers.get("Last-Modified") || "0"),
      size: +(res.headers.get("Content-Length") || "0"),
      contentType:
        res.headers.get("Content-Type") || "application/octet-stream",
      perm: (res.headers.get("X-Permission") as "rw" | "ro") || "rw",
    };
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
