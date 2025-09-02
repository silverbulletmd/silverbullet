import { fsEndpoint } from "../../lib/spaces/constants.ts";
import { decodePageURI } from "@silverbulletmd/silverbullet/lib/ref";
import type { SpacePrimitives } from "../../lib/spaces/space_primitives.ts";
import { fileMetaToHeaders } from "../../server/util.ts";
import { notFoundError } from "../../lib/constants.ts";

const alwaysProxy = [
  "/.auth",
  "/.logout",
  "/.config",
];

const pingTimeout = 2000;
const pingInterval = 5000;

export class ProxyRouter {
  fullSyncConfirmed = false;
  online = true;

  constructor(
    private spacePrimitives: SpacePrimitives,
    private basePathName: string,
    private baseURI: string,
    private precacheFiles: Record<string, string>,
  ) {
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
      globalThis.clients.matchAll().then((clients) => {
        clients.forEach((client) => {
          client.postMessage({ type: "sync", status: "online" });
        });
      });
    } catch {
      // Otherwise we're not
      this.online = false;
    } finally {
      if (oldOnline !== this.online) {
        console.info("Online status changed to", this.online);
      }
    }
  }

  /**
   * Called when a full space sync is complete, this will enable local request handling.
   */
  public handleSyncComplete() {
    if (!this.fullSyncConfirmed) {
      this.fullSyncConfirmed = true;
      console.log(
        "First full sync confirmed, will now start serving requests locally",
      );
    }
  }

  /**
   * Handles /.fs fetch events from the service worker.
   * @param event FetchEvent from the service worker
   */
  public handleFetch(event: any) {
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
          // Not fully synced yet, falling back to proxying to the server if we're online
          return fetch(request);
        }

        const pathname = requestUrl.pathname.substring(
          this.basePathName.length,
        ); //requestUrl.pathname without with any URL prefix removed

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
        this.online = false;
        return new Response("Offline", {
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
        return this.handleDelete(path);
      }
      default: {
        console.log("Unhandled method", request.method, "proxying to server");
        return fetch(request);
      }
    }
  }

  async handleFileListing(): Promise<Response> {
    const files = await this.spacePrimitives.fetchFileList();
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
        console.log("Serving file meta", path);
        const meta = await this.spacePrimitives.getFileMeta(path);
        return new Response(null, {
          headers: fileMetaToHeaders(meta),
        });
      } else {
        console.log("Serving file read", path);
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
        return new Response(notFoundError.message, {
          status: 404,
        });
      }
      console.error("Got error reading", path, err.message);
      return new Response(err.message, {
        status: 500,
      });
    }
  }

  async handlePut(path: string, request: Request): Promise<Response> {
    try {
      const body = await request.arrayBuffer();
      console.log("Handling file write", path, body.byteLength);
      const meta = await this.spacePrimitives.writeFile(
        path,
        new Uint8Array(body),
      );
      return new Response("OK", {
        status: 200,
        headers: fileMetaToHeaders(meta),
      });
    } catch (e: any) {
      console.error("Got error writing", path, e.message);
      return new Response(e.message, {
        status: 500,
      });
    }
  }

  async handleDelete(path: string): Promise<Response> {
    try {
      console.log("Handling file delete", path);
      await this.spacePrimitives.deleteFile(path);
      return new Response("OK", {
        status: 200,
      });
    } catch (e: any) {
      console.error("Got error deleting", path, e.message);
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
