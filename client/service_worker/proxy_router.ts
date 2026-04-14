import { fsEndpoint } from "../spaces/constants.ts";
import { decodePageURI } from "@silverbulletmd/silverbullet/lib/ref";
import type { SpacePrimitives } from "../spaces/space_primitives.ts";
import { fileMetaToHeaders, headersToFileMeta } from "../lib/util.ts";
import {
  isNetworkError,
  notFoundError,
  offlineError,
  pingInterval,
} from "@silverbulletmd/silverbullet/constants";
import type { SyncEngine } from "./sync_engine.ts";
import { EventEmitter } from "../plugos/event.ts";

const alwaysProxy = [
  "/.auth",
  "/.shell",
  "/.logout",
  "/.config",
  "/.logs",
  "/.proxy",
];

export type ProxyRouterEvents = {
  // Use case: the user likely has this file open in the editor, so it's good to prioritize syncing it
  observedRequest: (path: string) => void;
  // Use case: client showing the "yellow bar" indicating not being online
  onlineStatusUpdated: (isOnline: boolean) => void;
};

/**
 * Implements a service worker level HTTP proxy (fetch requests) that serves /.fs calls locally for synced spaces.
 *
 * Offline serving strategy:
 * - Static client assets (HTML, JS, CSS) are always served from the pre-cache (populated on SW install).
 * - File system (/.fs) requests are served locally from IndexedDB once a full sync has been confirmed.
 * - Before a full sync is confirmed, requests are proxied to the server. If the server is unreachable
 *   (network error), we fall through to serve locally so the app still works offline.
 * - `fullSyncConfirmed` is restored from the persisted sync snapshot on SW restart, so previously
 *   synced spaces serve locally immediately without needing a new sync cycle.
 */
export class ProxyRouter extends EventEmitter<ProxyRouterEvents> {
  // Tracks whether at least one full sync cycle has completed. Once true, /.fs
  // requests are served from local IndexedDB instead of being proxied. On SW
  // restart this is recovered from the persisted sync snapshot (see configure()).
  private fullSyncConfirmed = false;

  // Assumed online until checkOnline() determines otherwise. In airplane mode
  // the ping fails instantly; when the server is down but network is available
  // the ping times out after `pingTimeout` ms (see constants.ts).
  online = true;

  localSpacePrimitives?: SpacePrimitives;
  syncEngine?: SyncEngine;

  constructor(
    private basePathName: string,
    private baseURI: string,
    private precacheFiles: Record<string, string>,
  ) {
    super();
    // Actively check if we're online by pinging the server
    void this.checkOnline();
    setInterval(() => {
      void this.checkOnline();
    }, pingInterval);
  }

  /**
   * Called as soon the service worker is configured, and the service worker is ready to start serving requests.
   */
  configure(syncEngine: SyncEngine) {
    this.localSpacePrimitives = syncEngine.local;
    this.syncEngine = syncEngine;

    // If a previous sync snapshot exists with data, we can serve locally
    // immediately instead of waiting for a new sync cycle to complete.
    // This survives service worker restarts because the snapshot is
    // persisted in IndexedDB.
    if (syncEngine.snapshot.files.size > 0) {
      this.fullSyncConfirmed = true;
      console.log(
        "Previous sync snapshot found with",
        syncEngine.snapshot.files.size,
        "files, serving requests locally immediately",
      );
    }

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
  }

  /**
   * Stops service worker operation only to be continued after reconfiguration
   */
  reset() {
    console.log("Shutting down proxy router and linked components");
    if (this.syncEngine) {
      this.syncEngine.stop();
      this.syncEngine = undefined;
    }
  }

  async checkOnline() {
    if (this.syncEngine) {
      try {
        const serverVersion = await this.syncEngine.remote.ping();
        // If the ping is successful, we are online
        this.online = true;

        if (serverVersion) {
          const clients = await (self as any).clients.matchAll();
          for (const client of clients) {
            client.postMessage({
              type: "server-version",
              serverVersion,
            });
          }
        }
      } catch {
        // Otherwise we're not
        this.online = false;
      } finally {
        void this.emit("onlineStatusUpdated", this.online);
      }
    } else {
      console.info(
        "Sync engine not initialized yet, cannot check online status",
      );
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
        try {
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

          //requestUrl.pathname without with any URL prefix removed
          const pathname = requestUrl.pathname.substring(
            this.basePathName.length,
          );

          // Paths that can never be served locally (auth, shell, etc.) — always proxy.
          // If the proxy fails, there's no local fallback, so let the outer catch
          // return 503.
          if (alwaysProxy.find((prefix) => pathname.startsWith(prefix))) {
            return await fetch(request);
          }

          // Not yet configured (no sync engine / local storage) — must proxy.
          // No local data exists to fall back to.
          if (!this.localSpacePrimitives || !this.syncEngine) {
            return await fetch(request);
          }

          // Configured but no full sync confirmed yet and we think we're online —
          // try the server first. If it fails with a network error, fall through to
          // serve from local data (which may exist from a previous session's
          // snapshot). fullSyncConfirmed is recovered from the persisted snapshot on
          // SW restart (see configure()), so this condition only applies when no
          // previous sync data exists at all.
          if (!this.fullSyncConfirmed && this.online) {
            try {
              return await fetch(request);
            } catch (e: any) {
              // When the proxy fetch fails due to a network error, mark offline
              // and fall through to serve from local data instead of returning
              // a hard 503. We check for both the wrapped "Offline" error (from
              // HttpSpacePrimitives) and raw browser network errors (e.g.
              // "Failed to fetch" in Chrome, "NetworkError..." in Firefox,
              // "Load failed" in Safari) via isNetworkError().
              if (e.message === "Offline" || isNetworkError(e)) {
                console.info(
                  "Detected offline, marking offline and falling through",
                );
                this.online = false;
              } else {
                throw e;
              }
            }
          }

          // We are now in a state we're configured and either a full sync cycle has completed (since boot) OR we're offline

          if (
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
            return (
              (await caches.match(this.precacheFiles["/"])) || fetch(request)
            );
          }
        } catch (e: any) {
          console.warn("Fetch failed for", request.url, "error:", e.message);
          this.online = false;
          return new Response(offlineError.message, {
            status: 503, // Service Unavailable
          });
        }
      })(),
    );
  }

  handleRequest(pathname: string, request: Request): Promise<Response> {
    const path = decodePageURI(pathname.slice(fsEndpoint.length + 1));
    switch (request.method) {
      case "GET": {
        if (!path) {
          // .fs GET
          return this.handleFileListing();
        } else {
          // .fs/* GET
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

  /**
   * Shortcut to nonSyncedFiles kept in snapshot
   */
  get nonSyncedFiles() {
    return this.syncEngine!.snapshot.nonSyncedFiles;
  }

  async handleFileListing(): Promise<Response> {
    if (!this.syncEngine || !this.localSpacePrimitives) {
      throw new Error("This should not happen");
    }

    const files = await this.localSpacePrimitives.fetchFileList();
    // Now augment this with non-synced file metadata
    const localFileNames = new Set(files.map((f) => f.name));
    for (const nonSyncedFile of this.nonSyncedFiles.values()) {
      if (!localFileNames.has(nonSyncedFile.name)) {
        files.push(nonSyncedFile);
      }
    }
    return new Response(JSON.stringify(files), {
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  async handleGet(path: string, request: Request): Promise<Response> {
    if (!this.syncEngine || !this.localSpacePrimitives) {
      throw new Error("This should not happen");
    }

    try {
      if (request.headers.has("x-get-meta")) {
        // Requesting only file meta
        const meta = await this.localSpacePrimitives.getFileMeta(path);
        if (request.headers.has("x-observing")) {
          setTimeout(() => {
            // Next tick
            void this.emit("observedRequest", path);
          });
        }
        return new Response(null, {
          headers: fileMetaToHeaders(meta),
        });
      } else {
        const { meta, data } = await this.localSpacePrimitives.readFile(path);
        return new Response(data as any, {
          headers: fileMetaToHeaders(meta),
        });
      }
    } catch (err: any) {
      if (err.message === notFoundError.message && this.online) {
        console.info("No local copy of", path, "proxying to server");
        // Not found locally, but we're online, so let's try the server
        return fetch(request);
      } else if (err.message === notFoundError.message) {
        console.warn(
          "No local copy of",
          path,
          "and offline, so will 404 on this one",
        );
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
    if (!this.syncEngine || !this.localSpacePrimitives) {
      throw new Error("This should not happen");
    }
    try {
      // console.log("Doing a write for", path);
      if (!this.syncEngine.isSyncCandidate(path) && this.online) {
        console.log("Handling file write for non-synced file", path);
        // Writing a non-synced file while being online
        // Proxy the request
        const resp = await fetch(request);
        // Update the nonSynced snapshot in place for later file listing consistency
        this.nonSyncedFiles.set(path, headersToFileMeta(path, resp.headers)!);
        return resp;
      } else {
        // Synced file
        const body = await request.arrayBuffer();
        // console.log("Handling file write", path, body.byteLength);
        const meta = await this.localSpacePrimitives.writeFile(
          path,
          new Uint8Array(body),
          // Note: there are going to be many cases where no meta is supplied in the request, this is ok, in that case this argument will be undefined
          headersToFileMeta(path, request.headers),
        );
        // Attempt immediate sync
        try {
          const operations = await this.syncEngine.syncSingleFile(path);
          if (operations === -1) {
            console.info("File sync delayed for", path);
            // Sync was in progress, will sync later
            return new Response("Delayed", {
              status: 202,
              headers: fileMetaToHeaders(meta),
            });
          }
        } catch (e: any) {
          console.error(
            "File sync delayed for",
            path,
            "due to error",
            e.message,
          );
          // Sync failed (could be offline or other reason)
          return new Response(e.message, {
            status: 202,
            headers: fileMetaToHeaders(meta),
          });
        }

        return new Response("OK", {
          status: 200,
          headers: fileMetaToHeaders(meta),
        });
      }
    } catch (e: any) {
      console.error("Error writing", path, e.message);
      return new Response(e.message, {
        status: 500,
      });
    }
  }

  async handleDelete(path: string, request: Request): Promise<Response> {
    if (!this.syncEngine || !this.localSpacePrimitives) {
      throw new Error("This should not happen");
    }

    try {
      if (!this.syncEngine.isSyncCandidate(path)) {
        console.log("Handling file delete for non-synced file", path);
        this.nonSyncedFiles.delete(path);
        // Proxy the request
        return fetch(request);
      }
      // console.log("Handling file delete", path);
      await this.localSpacePrimitives.deleteFile(path);
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
