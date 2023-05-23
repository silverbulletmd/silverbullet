import { FileMeta } from "../types.ts";
import { SpacePrimitives } from "./space_primitives.ts";
import { flushCachesAndUnregisterServiceWorker } from "../sw_util.ts";

export class HttpSpacePrimitives implements SpacePrimitives {
  constructor(
    readonly url: string,
    readonly expectedSpacePath?: string,
    readonly syncMode = false,
  ) {
  }

  public async authenticatedFetch(
    url: string,
    options: RequestInit,
  ): Promise<Response> {
    if (!options.headers) {
      options.headers = {};
    }
    if (this.syncMode) {
      options.headers = { ...options.headers, ...{ "X-Sync-Mode": "true" } };
    }

    const result = await fetch(url, { ...options });
    if (
      result.status === 401
    ) {
      // Invalid credentials, reloading the browser should trigger authentication
      console.log("Going to redirect after", url);
      location.href = "/.auth?refer=" + location.pathname;
      throw new Error("Invalid credentials");
    }
    return result;
  }

  async fetchFileList(): Promise<FileMeta[]> {
    const resp = await this.authenticatedFetch(this.url, {
      method: "GET",
    });

    if (
      resp.status === 200 &&
      this.expectedSpacePath &&
      resp.headers.get("X-Space-Path") !== this.expectedSpacePath
    ) {
      await flushCachesAndUnregisterServiceWorker();
      alert("Space folder path different on server, reloading the page");
      location.reload();
    }

    return resp.json();
  }

  async readFile(
    name: string,
  ): Promise<{ data: Uint8Array; meta: FileMeta }> {
    const res = await this.authenticatedFetch(
      `${this.url}/${encodeURI(name)}`,
      {
        method: "GET",
      },
    );
    if (res.status === 404) {
      throw new Error(`Not found`);
    }
    return {
      data: new Uint8Array(await res.arrayBuffer()),
      meta: this.responseToMeta(name, res),
    };
  }

  async writeFile(
    name: string,
    data: Uint8Array,
    _selfUpdate?: boolean,
    lastModified?: number,
  ): Promise<FileMeta> {
    const headers: Record<string, string> = {
      "Content-Type": "application/octet-stream",
    };
    if (lastModified) {
      headers["X-Last-Modified"] = "" + lastModified;
    }

    const res = await this.authenticatedFetch(
      `${this.url}/${encodeURI(name)}`,
      {
        method: "PUT",
        headers,
        body: data,
      },
    );
    const newMeta = this.responseToMeta(name, res);
    return newMeta;
  }

  async deleteFile(name: string): Promise<void> {
    const req = await this.authenticatedFetch(
      `${this.url}/${encodeURI(name)}`,
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
      `${this.url}/${encodeURI(name)}`,
      {
        method: "OPTIONS",
      },
    );
    if (res.status === 404) {
      throw new Error(`Not found`);
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
}
