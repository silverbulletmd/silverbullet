import { SpacePrimitives } from "./space_primitives.ts";
import { FileMeta } from "../../plug-api/types.ts";
import { flushCachesAndUnregisterServiceWorker } from "../sw_util.ts";

export class HttpSpacePrimitives implements SpacePrimitives {
  constructor(
    readonly url: string,
    readonly expectedSpacePath?: string,
    private bearerToken?: string,
  ) {
  }

  public async authenticatedFetch(
    url: string,
    options: RequestInit,
  ): Promise<Response> {
    if (!options.headers) {
      options.headers = {};
    }
    options.headers = {
      ...options.headers,
      "X-Sync-Mode": "true",
    };
    if (this.bearerToken) {
      options.headers = {
        ...options.headers,
        "Authorization": `Bearer ${this.bearerToken}`,
      };
    }

    try {
      const result = await fetch(url, options);
      if (result.status === 503) {
        throw new Error("Offline");
      }
      if (result.redirected) {
        if (result.status === 401) {
          console.log(
            "Received unauthorized status and got a redirect via the API so will redirect to URL",
            result.url,
          );
          alert("You are not authenticated, redirecting to login page...");
          location.href = result.url;
          throw new Error("Not authenticated");
        } else {
          location.href = result.url;
          throw new Error("Redirected");
        }
      }
      if (result.status === 401) {
        location.reload();
        throw new Error("Not authenticated, got 403");
      }
      return result;
    } catch (e: any) {
      // Errors when there is no internet connection:
      //
      // * Firefox: NetworkError when attempting to fetch resource (with SW and without)
      // * Safari (service worker enabled): FetchEvent.respondWith received an error: TypeError: Load failed
      // * Safari (no service worker): Load failed
      // * Chrome: Failed to fetch
      //
      // Common substrings: "fetch" "load failed"
      const errorMessage = e.message.toLowerCase();
      if (
        errorMessage.includes("fetch") || errorMessage.includes("load failed")
      ) {
        console.error(
          "Got error fetching, throwing offline",
          url,
          e,
        );
        throw new Error("Offline");
      }
      throw e;
    }
  }

  async fetchFileList(): Promise<FileMeta[]> {
    const resp = await this.authenticatedFetch(`${this.url}/index.json`, {
      method: "GET",
    });

    if (
      resp.status === 200 &&
      this.expectedSpacePath &&
      resp.headers.get("X-Space-Path") &&
      resp.headers.get("X-Space-Path") !== this.expectedSpacePath
    ) {
      console.log("Expected space path", this.expectedSpacePath);
      console.log("Got space path", resp.headers.get("X-Space-Path"));
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
        headers: {
          // This header won't trigger CORS preflight requests but can be interpreted on the server
          Accept: "application/octet-stream",
        },
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
    meta?: FileMeta,
  ): Promise<FileMeta> {
    const headers: Record<string, string> = {
      "Content-Type": "application/octet-stream",
    };
    if (meta) {
      headers["X-Created"] = "" + meta.created;
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
    if (req.status !== 200) {
      throw Error(`Failed to delete file: ${req.statusText}`);
    }
  }

  async getFileMeta(name: string): Promise<FileMeta> {
    const res = await this.authenticatedFetch(
      `${this.url}/${encodeURI(name)}`,
      // This used to use HEAD, but it seems that Safari on iOS is blocking cookies/credentials to be sent along with HEAD requests
      // so we'll use GET instead with a magic header which the server may or may not use to omit the body.
      {
        method: "GET",
        headers: {
          "X-Get-Meta": "true",
        },
      },
    );
    if (res.status === 404) {
      throw new Error(`Not found`);
    }
    if (!res.ok) {
      throw new Error(`Failed to get file meta: ${res.statusText}`);
    }
    return this.responseToMeta(name, res);
  }

  private responseToMeta(name: string, res: Response): FileMeta {
    return {
      name,
      // The server may set a custom X-Content-Length header in case a GET request was sent with X-Get-Meta, in which case the body may be omitted
      size: res.headers.has("X-Content-Length")
        ? +res.headers.get("X-Content-Length")!
        : +res.headers.get("Content-Length")!,
      contentType: res.headers.get("Content-type")!,
      created: +(res.headers.get("X-Created") || "0"),
      lastModified: +(res.headers.get("X-Last-Modified") || "0"),
      perm: (res.headers.get("X-Permission") as "rw" | "ro") || "ro",
    };
  }

  // Used to check if the server is reachable and the user is authenticated
  // If not: throws an error or invokes a redirect
  async ping() {
    await this.authenticatedFetch(`${this.url}/index.json`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });
  }
}
