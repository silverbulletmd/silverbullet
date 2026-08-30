import {
  isNetworkError,
  notFoundError,
  offlineError,
  pingInterval,
} from "@silverbulletmd/silverbullet/constants";
import { decodePageURI } from "@silverbulletmd/silverbullet/lib/ref";
import { fileMetaToHeaders, headersToFileMeta } from "../lib/util.ts";
import { EventEmitter } from "../plugos/event.ts";
import { fsEndpoint } from "../spaces/constants.ts";
import type { SpacePrimitives } from "../spaces/space_primitives.ts";
import type { SyncEngine } from "./sync_engine.ts";

// The server surfaces every space carries under its own base path. This worker
// can answer exactly two of them for its OWN space — `.client` from the
// install-time precache and `.fs` from locally synced files — and proxies the
// rest. Both lists below derive from this one, so a new surface is declared
// once instead of being kept in sync by hand.
const spaceSurfaces = [
  "/.client",
  "/.fs",
  "/.events",
  "/.auth",
  "/.config",
  "/.logout",
  "/.shell",
  "/.proxy",
  "/.logs",
  "/.revisions",
  "/.accounts",
];
const locallyServed = ["/.client", "/.fs"];

// Always straight to the server: the space surfaces we have no local answer
// for, plus the server-wide ones, which only ever exist at the origin root.
// Matched as a prefix of the *space-relative* path.
const alwaysProxy = [
  ...spaceSurfaces.filter((surface) => !locallyServed.includes(surface)),
  "/.spaces",
  "/.setup",
  "/.instance",
];

const anotherSpaceSurface = new RegExp(
  `/[^/]+/\\.(${spaceSurfaces
    .map((surface) => surface.slice("/.".length))
    .join("|")})(/|$)`,
);

/**
 * Whether a space-relative path belongs to a *different* space on this origin.
 *
 * A space bound at "/" registers its worker at scope "/", so it is handed every
 * sibling space's requests too. A space surface one or more levels down —
 * "/notes/.client/auth.js" — is by definition not ours, since our own sit
 * directly under our base. Answering those from our precache is how a sibling's
 * login page came back as this space's app shell.
 */
export function belongsToAnotherSpace(pathname: string): boolean {
  return anotherSpaceSurface.test(pathname);
}

/**
 * The origin's space roots that fall inside this worker's scope, made
 * space-relative.
 *
 * A worker only ever sees requests under its own base, so prefixes outside it
 * are unreachable here; its own base is not a sibling. For a root-bound worker
 * (base "") that leaves every other prefix space.
 */
export function scopedSiblingPrefixes(
  basePathName: string,
  spacePrefixes: string[],
): string[] {
  return spacePrefixes
    .filter((prefix) => prefix.startsWith(`${basePathName}/`))
    .map((prefix) => prefix.slice(basePathName.length));
}

/**
 * Whether a space-relative path lies within a sibling space's root.
 *
 * `belongsToAnotherSpace` recognizes a sibling only by its *surfaces*
 * ("/private/.client/..."). A bare sibling root ("/private/") is
 * indistinguishable from one of our own pages without knowing the origin's
 * prefixes, and answering it from our precached shell hands the visitor this
 * space's `<base href>` under the sibling's URL.
 */
export function belongsToSiblingSpace(
  pathname: string,
  siblingPrefixes: string[],
): boolean {
  return siblingPrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Whether a request may be answered from the local base store while the very
 * first sync cycle is still running (i.e. before `fullSyncConfirmed`).
 * Non-markdown GETs qualify even without the X-Sync-Mode header: plug worker
 * scripts and attachments are fetched by the browser itself, and proxying an
 * already-synced .plug.js on a slow link can push the worker boot past its
 * 5s creation timeout. Bare .md navigations keep proxy-first behavior.
 */
export function isInitialSyncLocalReadCandidate(
  method: string,
  pathname: string,
  headers: Headers,
): boolean {
  return (
    method === "GET" &&
    pathname.startsWith(`${fsEndpoint}/`) &&
    pathname.length > fsEndpoint.length + 1 &&
    (headers.has("X-Sync-Mode") || !pathname.endsWith(".md"))
  );
}

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

  private siblingPrefixes: string[] = [];

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

  setSpacePrefixes(spacePrefixes: string[]) {
    this.siblingPrefixes = scopedSiblingPrefixes(
      this.basePathName,
      spacePrefixes,
    );
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

          // Another space, reachable only because this worker's scope covers
          // its prefix. Never ours to answer — including while we believe we
          // are offline, when the SPA-shell fallback below would otherwise
          // hand back this space's shell under the sibling's URL.
          if (
            belongsToAnotherSpace(pathname) ||
            belongsToSiblingSpace(pathname, this.siblingPrefixes)
          ) {
            return await fetch(request);
          }

          // Not yet configured (no sync engine / local storage) — must proxy.
          // No local data exists to fall back to.
          if (!this.localSpacePrimitives || !this.syncEngine) {
            return await fetch(request);
          }

          if (!this.fullSyncConfirmed && this.online) {
            // A file the initial sync has already pulled down can be served
            // locally right away, a miss falls through to the proxy fetch
            // below.
            if (
              isInitialSyncLocalReadCandidate(
                request.method,
                pathname,
                request.headers,
              )
            ) {
              const path = decodePageURI(pathname.slice(fsEndpoint.length + 1));
              try {
                if (request.headers.has("x-get-meta")) {
                  const meta =
                    await this.localSpacePrimitives.getFileMeta(path);
                  return new Response(null, {
                    headers: fileMetaToHeaders(meta),
                  });
                }
                const { meta, data } =
                  await this.localSpacePrimitives.readFile(path);
                return new Response(data as any, {
                  headers: fileMetaToHeaders(meta),
                });
              } catch {
                // Not synced yet (or unreadable) — proxy as before.
              }
            }
            try {
              return await fetch(request);
            } catch (e: any) {
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
            // Fallback to the app shell for all other requests (SPA).
            if (request.mode === "navigate" && this.online) {
              try {
                return await fetch(request);
              } catch (e: any) {
                if (e.message !== "Offline" && !isNetworkError(e)) {
                  throw e;
                }
                this.online = false;
              }
            }
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
        this.syncEngine.requestFileSync(path, { type: "local" });

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
