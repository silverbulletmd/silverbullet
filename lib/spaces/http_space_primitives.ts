import type { SpacePrimitives } from "./space_primitives.ts";
import { encodePageURI } from "@silverbulletmd/silverbullet/lib/ref";
import {
  flushCachesAndUnregisterServiceWorker,
} from "../../web/service_worker/util.ts";
import type { FileMeta } from "../../type/index.ts";
import { notFoundError, offlineError } from "../constants.ts";
import { headersToFileMeta } from "../../server/util.ts";

const defaultFetchTimeout = 30000; // 30 seconds

export class HttpSpacePrimitives implements SpacePrimitives {
  constructor(
    readonly url: string,
    readonly expectedSpacePath: string,
    private authErrorCallback: (message: string, ...args: any[]) => void,
    private bearerToken?: string,
  ) {
  }

  public async authenticatedFetch(
    url: string,
    options: RequestInit,
    fetchTimeout: number = defaultFetchTimeout,
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
      options.signal = AbortSignal.timeout(fetchTimeout);
      options.redirect = "manual";
      const result = await fetch(url, options);
      if (result.status === 503) {
        throw offlineError;
      }
      const redirectHeader = result.headers.get("location");

      if (result.type === "opaqueredirect" && !redirectHeader) {
        console.log("Result", result, "for", url, JSON.stringify(options));
        // This is a scenario where the server sent a redirect, but this redirect is not visible to the client, likely due to CORS
        // The best we can do is to reload the page and hope that the server will redirect us to the correct location
        this.authErrorCallback(
          "You are not authenticated, reloading to reauthenticate",
          "reload",
        );
        // console.log("Unregistering service workers", redirectHeader);
        // await unregisterServiceWorkers();
        // location.reload();
        // Let's throw to avoid any further processing
        throw Error("Not authenticated");
      }

      // console.log("Got response", result.status, result.statusText, result.url);

      // Attempting to handle various authentication proxies
      if (result.status >= 300 && result.status < 400) {
        if (redirectHeader) {
          // Got a redirect
          this.authErrorCallback(
            "Received an authentication redirect",
            redirectHeader,
          );
          // location.href = redirectHeader;
          throw new Error("Redirected");
        } else {
          console.error("Got a redirect status but no location header", result);
        }
      }
      // Check for unauthorized status
      if (result.status === 401 || result.status === 403) {
        // If it came with a redirect header, we'll redirect to that URL
        if (redirectHeader) {
          console.log(
            "Received unauthorized status and got a redirect via the API so will redirect to URL",
            result.url,
          );
          this.authErrorCallback("You are not authenticated ", redirectHeader);
          // location.href = redirectHeader;
          throw new Error("Not authenticated");
        } else {
          // If not, let's reload
          this.authErrorCallback(
            "You are not authenticated, going to reload and hope that that kicks off authentication",
          );
          // location.reload();
          throw new Error("Not authenticated");
        }
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
        throw offlineError;
      }
      throw e;
    }
  }

  async fetchFileList(): Promise<FileMeta[]> {
    const resp = await this.authenticatedFetch(this.url, {
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
      this.authErrorCallback(
        "Space folder path different on server, reloading the page",
        "reload",
      );
      // location.reload();
    }

    return resp.json();
  }

  async readFile(
    path: string,
  ): Promise<{ data: Uint8Array; meta: FileMeta }> {
    const res = await this.authenticatedFetch(
      `${this.url}/${encodePageURI(path)}`,
      {
        method: "GET",
        headers: {
          // This header won't trigger CORS preflight requests but can be interpreted on the server
          Accept: "application/octet-stream",
        },
      },
    );
    if (res.status === 404) {
      throw notFoundError;
    }
    return {
      data: new Uint8Array(await res.arrayBuffer()),
      meta: headersToFileMeta(path, res.headers)!,
    };
  }

  async writeFile(
    path: string,
    data: Uint8Array,
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
      `${this.url}/${encodePageURI(path)}`,
      {
        method: "PUT",
        headers,
        body: data,
      },
    );
    return headersToFileMeta(path, res.headers)!;
  }

  async deleteFile(path: string): Promise<void> {
    const req = await this.authenticatedFetch(
      `${this.url}/${encodePageURI(path)}`,
      {
        method: "DELETE",
      },
    );
    if (req.status !== 200) {
      throw Error(`Failed to delete file: ${req.statusText}`);
    }
  }

  async getFileMeta(path: string, observing?: boolean): Promise<FileMeta> {
    const res = await this.authenticatedFetch(
      `${this.url}/${encodePageURI(path)}`,
      // This used to use HEAD, but it seems that Safari on iOS is blocking cookies/credentials to be sent along with HEAD requests
      // so we'll use GET instead with a magic header which the server may or may not use to omit the body.
      {
        method: "GET",
        headers: {
          "X-Get-Meta": "true",
          ...(observing ? { "X-Observing": "true" } : {}),
        },
      },
    );
    if (res.status === 404) {
      throw notFoundError;
    }
    if (!res.ok) {
      throw new Error(`Failed to get file meta: ${res.statusText}`);
    }
    return headersToFileMeta(path, res.headers)!;
  }

  // If not: throws an error or invokes a redirect
  async ping() {
    const parentEndpoint = this.url.split("/").slice(0, -1).join("/") +
      "/.ping";
    const response = await this.authenticatedFetch(parentEndpoint, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    }, 5000);

    // Consume the response body to avoid leaks
    await response.text();
  }
}
