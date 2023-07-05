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

    const result = await fetch(url, {
      ...options,
    });
    if (result.redirected) {
      // Got a redirect, we'll assume this is due to invalid credentials and redirecting to an auth page
      console.log(
        "Got a redirect via the API so will redirect to URL",
        result.url,
      );
      location.href = result.url;
      throw new Error("Invalid credentials");
    }
    return result;
  }

  getRealStatus(r: Response) {
    if (r.headers.get("X-Status")) {
      return +r.headers.get("X-Status")!;
    }
    return r.status;
  }

  async fetchFileList(): Promise<FileMeta[]> {
    const resp = await this.authenticatedFetch(this.url, {
      method: "GET",
    });

    if (
      this.getRealStatus(resp) === 200 &&
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
    if (this.getRealStatus(res) === 404) {
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
    meta?: FileMeta,
  ): Promise<FileMeta> {
    const headers: Record<string, string> = {
      "Content-Type": "application/octet-stream",
    };
    if (meta) {
      headers["X-Last-Modified"] = "" + meta.lastModified;
      headers["X-Perm"] = "" + meta.perm;
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
    if (this.getRealStatus(req) !== 200) {
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
    if (this.getRealStatus(res) === 404) {
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
