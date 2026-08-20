import type { SpacePrimitives } from "./space_primitives.ts";
import { encodePageURI } from "@silverbulletmd/silverbullet/lib/ref";
import { flushCachesAndUnregisterServiceWorker } from "../../client/service_worker/util.ts";
import type { FileMeta } from "@silverbulletmd/silverbullet/type/index";
import {
  isNetworkError,
  notFoundError,
  offlineError,
  pingTimeout,
  wrongSpacePathError,
} from "@silverbulletmd/silverbullet/constants";
import { headersToFileMeta } from "../lib/util.ts";
import { etagForHash, hashFromEtag } from "./revision.ts";

const defaultFetchTimeout = 30000; // 30 seconds

export type WritePrecondition =
  | { type: "matchesHash"; hash: string }
  | { type: "notExists" };

export class PreconditionFailedError extends Error {}

export type ReconcileRequest = {
  baseHash: string;
  baseText: string;
  proposedHash: string;
  proposedText: string;
  source?: string;
};

export type ReconcileRevision = {
  algorithm: string;
  hash: string;
  size: number;
  lastModified: number;
};

export type ReconcileResponse =
  | {
      status: "applied" | "merged" | "conflicted";
      revision: ReconcileRevision;
      text: string;
    }
  | { status: "retry"; revision: ReconcileRevision };

export class ReconcileIneligibleError extends Error {}

export function parseReconcileResponse(
  status: number,
  body: unknown,
): ReconcileResponse | null {
  if (status === 404 || status === 405) {
    return null;
  }
  if (status === 409 || status === 413) {
    throw new ReconcileIneligibleError(`Reconcile ineligible: ${status}`);
  }
  if (status !== 200) {
    throw new Error(`Failed to reconcile: ${status}`);
  }
  return body as ReconcileResponse;
}

// WebKit (Safari, WKWebView) strips custom response headers (X-Last-Modified,
// etc.) when it recognizes a file extension in the URL. Encoding the last dot
// as %2E prevents this; the server decodes it transparently.
const isWebKit =
  typeof navigator !== "undefined" &&
  /AppleWebKit/.test(navigator.userAgent) &&
  !/Chrome/.test(navigator.userAgent);

function encodeExtensionDot(url: string): string {
  // Only encode the file extension dot, not dots in the path prefix (like /.fs).
  // Manipulate the raw string — Safari's URL.pathname setter rejects %2E.
  const fsIdx = url.indexOf("/.fs/");
  if (fsIdx < 0) return url;
  const afterFs = fsIdx + 5; // position after "/.fs/"
  const filePart = url.substring(afterFs);
  const qIdx = filePart.indexOf("?");
  const path = qIdx >= 0 ? filePart.substring(0, qIdx) : filePart;
  const rest = qIdx >= 0 ? filePart.substring(qIdx) : "";
  const lastDot = path.lastIndexOf(".");
  if (lastDot > path.lastIndexOf("/")) {
    return (
      url.substring(0, afterFs) +
      path.substring(0, lastDot) +
      "%2E" +
      path.substring(lastDot + 1) +
      rest
    );
  }
  return url;
}

export class HttpSpacePrimitives implements SpacePrimitives {
  constructor(
    readonly url: string,
    readonly expectedSpacePath: string,
    private authErrorCallback: (message: string, ...args: any[]) => void,
    private bearerToken?: string,
    // Best-effort attribution (never load-bearing): sent as X-Client-Id/
    // X-Source on mutating requests only (PUT/DELETE/reconcile), never GETs.
    private clientId?: string,
    private source?: string,
  ) {}

  private clientHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.clientId) headers["X-Client-Id"] = this.clientId;
    if (this.source) headers["X-Source"] = this.source;
    return headers;
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
        Authorization: `Bearer ${this.bearerToken}`,
      };
    }

    try {
      if (isWebKit) {
        url = encodeExtensionDot(url);
      }
      if (fetchTimeout > 0) {
        options.signal = AbortSignal.timeout(fetchTimeout);
      }
      options.redirect = "manual";
      const result = await fetch(url, options);
      if (result.status >= 500 && result.status < 600) {
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
      // AbortSignal.timeout() throws a DOMException with name "TimeoutError".
      // This is NOT an offline condition — the network may be fine, just slow.
      if (e.name === "TimeoutError") {
        console.warn("Request timed out for", url);
        throw new Error(`Request timed out after ${fetchTimeout}ms`);
      }
      if (isNetworkError(e)) {
        console.error("Got error fetching, throwing offline", url, e.message);
        throw offlineError;
      }
      throw e;
    }
  }

  async fetchFileList(): Promise<FileMeta[]> {
    const resp = await this.authenticatedFetch(this.url, {
      method: "GET",
    });

    await this.validateSpacePathFromHeaders(resp);
    return resp.json();
  }

  /**
   * The /.fs file listing and /.ping endpoints both expose the currently exposed space path, if this doesn't match what the client expects, the client has to restart
   */
  async validateSpacePathFromHeaders(resp: Response) {
    if (
      resp.status === 200 &&
      this.expectedSpacePath &&
      resp.headers.get("X-Space-Path") &&
      resp.headers.get("X-Space-Path") !== this.expectedSpacePath
    ) {
      console.log("Expected space path", this.expectedSpacePath);
      console.log("Got space path", resp.headers.get("X-Space-Path"));
      await flushCachesAndUnregisterServiceWorker();
      this.authErrorCallback(wrongSpacePathError.message, "reload");
    }
  }

  async readFile(path: string): Promise<{ data: Uint8Array; meta: FileMeta }> {
    const { data, meta } = await this.readFileWithHash(path);
    return { data, meta };
  }

  async readFileWithHash(
    path: string,
  ): Promise<{ data: Uint8Array; meta: FileMeta; remoteHash?: string }> {
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
      remoteHash: hashFromEtag(res.headers.get("ETag")),
    };
  }

  async writeFile(
    path: string,
    data: Uint8Array,
    meta?: FileMeta,
  ): Promise<FileMeta> {
    const { meta: resultMeta } = await this.writeFileConditional(
      path,
      data,
      meta,
    );
    return resultMeta;
  }

  async writeFileConditional(
    path: string,
    data: Uint8Array,
    meta?: FileMeta,
    precondition?: WritePrecondition,
  ): Promise<{ meta: FileMeta; remoteHash?: string }> {
    const headers: Record<string, string> = {
      "Content-Type": "application/octet-stream",
      ...this.clientHeaders(),
    };
    if (meta) {
      headers["X-Created"] = `${meta.created}`;
      headers["X-Last-Modified"] = `${meta.lastModified}`;
      headers["X-Perm"] = `${meta.perm}`;
    }
    if (precondition) {
      if (precondition.type === "matchesHash") {
        headers["If-Match"] = etagForHash(precondition.hash);
      } else {
        headers["If-None-Match"] = "*";
      }
    }

    const res = await this.authenticatedFetch(
      `${this.url}/${encodePageURI(path)}`,
      {
        method: "PUT",
        headers,
        // Casting to any due to TypeScript fetch type limitations
        body: data as any,
      },
      0, // No timeout for uploads — transfer time depends on file size and connection speed
    );
    if (res.status === 412) {
      throw new PreconditionFailedError(`Precondition failed for ${path}`);
    }
    return {
      meta: headersToFileMeta(path, res.headers)!,
      remoteHash: hashFromEtag(res.headers.get("ETag")),
    };
  }

  async reconcile(
    path: string,
    req: ReconcileRequest,
  ): Promise<ReconcileResponse | null> {
    const res = await this.authenticatedFetch(
      `${this.url}/${encodePageURI(path)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.clientHeaders(),
        },
        body: JSON.stringify(req),
      },
    );
    const body = res.status === 200 ? await res.json() : undefined;
    return parseReconcileResponse(res.status, body);
  }

  async deleteFile(path: string): Promise<void> {
    await this.deleteFileConditional(path);
  }

  async deleteFileConditional(
    path: string,
    expectedHash?: string,
  ): Promise<void> {
    const headers: Record<string, string> = { ...this.clientHeaders() };
    if (expectedHash !== undefined) {
      headers["If-Match"] = etagForHash(expectedHash);
    }
    const req = await this.authenticatedFetch(
      `${this.url}/${encodePageURI(path)}`,
      {
        method: "DELETE",
        headers,
      },
    );
    if (req.status === 412) {
      throw new PreconditionFailedError(`Precondition failed for ${path}`);
    }
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
  async ping(): Promise<string | undefined> {
    const parentEndpoint = `${this.url.split("/").slice(0, -1).join("/")}/.ping`;
    const resp = await this.authenticatedFetch(
      parentEndpoint,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      },
      pingTimeout,
    );

    if (!resp.ok) {
      throw new Error(`Ping failed: ${resp.status} ${resp.statusText}`);
    }

    await this.validateSpacePathFromHeaders(resp);

    const serverVersion = resp.headers.get("X-Server-Version") ?? undefined;

    // Consume the response body to avoid leaks
    await resp.text();

    return serverVersion;
  }
}
