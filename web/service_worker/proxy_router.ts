import { fsEndpoint } from "../../lib/spaces/constants.ts";
import { decodePageURI } from "@silverbulletmd/silverbullet/lib/ref";
import type { SpacePrimitives } from "../../lib/spaces/space_primitives.ts";
import { fileMetaToHeaders } from "../../server/util.ts";
import { notFoundError, offlineError } from "../../lib/constants.ts";
import type { SyncEngine } from "./sync_engine.ts";
import { EventEmitter } from "../../lib/plugos/event.ts";

const alwaysProxy = [
  "/.auth",
  "/.logout",
  "/.config",
];

const pingTimeout = 2000;
const pingInterval = 5000;

export type ProxyRouterEvents = {
  // Use case: sync engine may more pro-actively sync this one file back to the server
  fileWritten: (path: string) => void;
  // Use case: the user likely has this file open in the editor, so it's good to prioritize syncing it
  observedRequest: (path: string) => void;
  // Use case: client showing the "yellow bar" indicating not being online
  onlineStatusChanged: (isOnline: boolean) => void;
};

/**
 * Implements a service worker level HTTP proxy (fetch requests) that serves /.fs calls locally for synced spaces
 */
export class ProxyRouter extends EventEmitter<ProxyRouterEvents> {
  fullSyncConfirmed = false;
  online = true;

  constructor(
    private spacePrimitives: SpacePrimitives,
    public syncEngine: SyncEngine,
    private basePathName: string,
    private baseURI: string,
    private precacheFiles: Record<string, string>,
  ) {
    super();
    syncEngine.on({
      spaceSyncComplete: () => {
        if (!this.fullSyncConfirmed) {
          this.fullSyncConfirmed = true;
          console.log(
            "First full sync confirmed, will now start serving requests locally",
          );
        }
      },
    });
    // Actively check if we're online by pinging the server
    this.checkOnline();
    setInterval(() => {
      this.checkOnline();
    }, pingInterval);
  }

  async checkOnline() {
    const oldOnline = this.online;
    try {
      await fetch(this.baseURI + "/.ping", {
        signal: AbortSignal.timeout(pingTimeout),
      });
      // If the ping is successful, we are online
      this.online = true;
    } catch {
      // Otherwise we're not
      this.online = false;
    } finally {
      if (oldOnline !== this.online) {
        this.emit("onlineStatusChanged", this.online);
      }
    }
  }

  /**
   * Handles /.fs fetch events from the service worker.
   * @param event FetchEvent from the service worker
   */
  public onFetch(event: any) {
    const url = new URL(event.request.url);

    const pathname = url.pathname.substring(this.basePathName.length); //url.pathname with any URL prefix removed

    // Use the custom cache key if available, otherwise use the request URL
    const cacheKey = this.precacheFiles[pathname] || event.request.url;

    event.respondWith(
      (async () => {
        const request = event.request;
        const requestUrl = new URL(request.url);

        // Are we fetching a URL from the same origin as the app? If not, we don't handle it and pass it on
        if (!requestUrl.href.startsWith(this.baseURI)) {
          return fetch(request);
        }

        // Try the static (client) file cache first
        const cachedResponse = await caches.match(cacheKey);
        // Return the cached response if found
        if (cachedResponse) {
          return cachedResponse;
        }

        if (!this.fullSyncConfirmed && this.online) {
          // Not synced yet and we are online, falling back to proxying to the server if we're online
          return fetch(request);
        }

        //requestUrl.pathname without with any URL prefix removed
        const pathname = requestUrl.pathname.substring(
          this.basePathName.length,
        );

        if (alwaysProxy.includes(pathname)) {
          return fetch(request);
        } else if (
          pathname.startsWith(fsEndpoint) &&
          pathname.endsWith(".md") &&
          !request.headers.has("X-Sync-Mode")
        ) {
          // This handles the case of ending up with a .md URL in the browser address bar (likely due to a auth proxy redirect)
          return Response.redirect(
            `${pathname.slice(fsEndpoint.length, -3)}`,
          );
        } else if (pathname.startsWith(fsEndpoint)) {
          // Handle /.fs file system APIs
          return this.handleRequest(pathname, request);
        } else {
          // Fallback to the app shell for all other requests (SPA)
          return (await caches.match(this.precacheFiles["/"])) ||
            fetch(request);
        }
      })().catch((e) => {
        console.warn("Fetch failed:", e);
        return new Response(offlineError.message, {
          status: 503, // Service Unavailable
        });
      }),
    );
  }

  handleRequest(
    pathname: string,
    request: Request,
  ): Promise<Response> {
    const path = decodePageURI(pathname.slice(fsEndpoint.length + 1));
    switch (request.method) {
      case "GET": {
        if (!path) { // .fs GET
          return this.handleFileListing();
        } else { // .fs/* GET
          return this.handleGet(path, request);
        }
      }
      case "PUT": {
        return this.handlePut(path, request);
      }
      case "DELETE": {
        return this.handleDelete(path, request);
      }
      default: {
        console.log("Unhandled method", request.method, "proxying to server");
        return fetch(request);
      }
    }
  }

  async handleFileListing(): Promise<Response> {
    const files = await this.spacePrimitives.fetchFileList();
    // Now augment this with non-synced file metadata
    for (const nonSyncedFile of this.syncEngine.nonSyncedFiles.values()) {
      const existingFile = files.find((file) =>
        file.name === nonSyncedFile.name
      );
      if (!existingFile) {
        files.push(nonSyncedFile);
      }
    }
    return new Response(
      JSON.stringify(files),
      {
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  }

  async handleGet(path: string, request: Request): Promise<Response> {
    try {
      if (request.headers.has("x-get-meta")) {
        // Requesting only file meta
        // console.log("Serving file meta", path);
        const meta = await this.spacePrimitives.getFileMeta(path);
        if (request.headers.has("x-observing")) {
          this.emit("observedRequest", path);
        }
        return new Response(null, {
          headers: fileMetaToHeaders(meta),
        });
      } else {
        // console.log("Serving file read", path);
        const { meta, data } = await this.spacePrimitives.readFile(path);
        return new Response(data, {
          headers: fileMetaToHeaders(meta),
        });
      }
    } catch (err: any) {
      console.warn("Error reading/file meta'ing", path, err.message);
      if (err.message === notFoundError.message && this.online) {
        // Not found locally, but we're online, so let's try the server
        return fetch(request);
      } else if (err.message === notFoundError.message) {
        // We're not online so let's assume the file indeed doesn't exist
        // TODO: What could be nice here is to check if this is a nonSyncedFile and if so serve some sort of offline placeholder
        return new Response(notFoundError.message, {
          status: 404,
        });
      }
      console.error("Error reading", path, err.message);
      return new Response(err.message, {
        status: 500,
      });
    }
  }

  async handlePut(path: string, request: Request): Promise<Response> {
    try {
      if (!this.syncEngine.isSyncCandidate(path) && this.online) {
        console.log("Handling file write for non-synced file", path);
        // Writing a non-synced file while being online
        // Proxy the request
        const resp = await fetch(request);
        // Put in a placeholder metadata in the nonSynced files
        this.syncEngine.nonSyncedFiles.set(path, {
          name: path,
          lastModified: Date.now(),
          created: Date.now(),
          contentType: "application/octet-stream",
          perm: "rw",
          size: +(resp.headers.get("X-Content-Length") || 0),
        });
        return resp;
      }
      const body = await request.arrayBuffer();
      // console.log("Handling file write", path, body.byteLength);
      const meta = await this.spacePrimitives.writeFile(
        path,
        new Uint8Array(body),
      );
      this.emit("fileWritten", path);
      return new Response("OK", {
        status: 200,
        headers: fileMetaToHeaders(meta),
      });
    } catch (e: any) {
      console.error("Error writing", path, e.message);
      return new Response(e.message, {
        status: 500,
      });
    }
  }

  async handleDelete(path: string, request: Request): Promise<Response> {
    try {
      if (!this.syncEngine.isSyncCandidate(path)) {
        console.log("Handling file delete for non-synced file", path);
        this.syncEngine.nonSyncedFiles.delete(path);
        // Proxy the request
        return fetch(request);
      }
      // console.log("Handling file delete", path);
      await this.spacePrimitives.deleteFile(path);
      return new Response("OK", {
        status: 200,
      });
    } catch (e: any) {
      console.error("Error deleting", path, e.message);
      if (e.message === notFoundError.message) {
        return new Response(notFoundError.message, {
          status: 404,
        });
      }
      return new Response(e.message, {
        status: 500,
      });
    }
  }
}
