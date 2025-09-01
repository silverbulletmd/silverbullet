import type { DataStore } from "../../lib/data/datastore.ts";
import { fsEndpoint } from "../../lib/spaces/constants.ts";
import { decodePageURI } from "@silverbulletmd/silverbullet/lib/ref";
import type { FileContent } from "../../lib/spaces/datastore_space_primitives.ts";

const filesContentPrefix = ["file", "content"];

export class ProxyRouter {
  fullSyncConfirmed = false;

  constructor(
    private ds: DataStore,
    private basePathName: string,
    private baseURI: string,
    private precacheFiles: Record<string, string>,
  ) {
    console.log("Activating this shit!");
  }

  handleFetch(event: any) {
    const url = new URL(event.request.url);
    console.log("Getting requests now", url);

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

        // Any request with the X-Sync-Mode header originates from the sync engine: pass it on to the server
        if (request.headers.has("x-sync-mode")) {
          return fetch(request);
        }

        // Try the static (client) file cache first
        const cachedResponse = await caches.match(cacheKey);
        // Return the cached response if found
        if (cachedResponse) {
          return cachedResponse;
        }

        if (!this.fullSyncConfirmed) {
          // Not fully synced yet, falling back to actual server
          return fetch(request);
        }

        const pathname = requestUrl.pathname.substring(
          this.basePathName.length,
        ); //requestUrl.pathname without with any URL prefix removed

        if (
          pathname === "/.auth" ||
          pathname === "/.logout" ||
          pathname === "/.config" ||
          pathname === "/.fs"
        ) {
          // Always proxy auth, config and fs listing requests to the server
          return fetch(request);
        } else if (
          pathname.startsWith(fsEndpoint) &&
          pathname.endsWith(".md") &&
          request.headers.get("accept") !== "application/octet-stream" &&
          request.headers.get("sec-fetch-mode") !== "cors"
        ) {
          // This handles the case of ending up with a .md URL in the browser address bar (likely due to a auth proxy redirect)
          return Response.redirect(
            `${pathname.slice(fsEndpoint.length, -3)}`,
          );
        } else if (
          // /.fs file system APIs: handled locally
          pathname.startsWith(fsEndpoint)
        ) {
          return this.handleRequest(pathname, request);
        } else {
          // Fallback to the SB app shell for all other requests (SPA)
          return (await caches.match(this.precacheFiles["/"])) ||
            fetch(request);
        }
      })().catch((e) => {
        console.warn("[Service worker]", "Fetch failed:", e);
        return new Response("Offline", {
          status: 503, // Service Unavailable
        });
      }),
    );
  }

  async handleRequest(
    pathname: string,
    request: Request,
  ): Promise<Response> {
    const path = decodePageURI(pathname.slice(fsEndpoint.length + 1));
    console.log(
      "[sync proxy]",
      "Handling local file",
      path,
      "with",
      request.method,
    );
    switch (request.method) {
      case "GET": {
        const data = await this.ds.get<FileContent>([
          ...filesContentPrefix,
          path,
        ]);
        if (data) {
          console.log("Serving GET from space", path);
          return new Response(
            data.data,
            {
              headers: {
                "Content-type": data.meta.contentType,
                "Content-Length": "" + data.meta.size,
                "X-Permission": data.meta.perm,
                "X-Created": "" + data.meta.created,
                "X-Last-Modified": "" + data.meta.lastModified,
              },
            },
          );
        } else {
          console.warn(
            "Did not find file in locally synced space",
            path,
            "passing on to server",
          );
          return fetch(request);
        }
      }
      default: {
        console.log("Unhandled method", request.method, "proxying to server");
        return fetch(request);
      }
    }
  }
}
