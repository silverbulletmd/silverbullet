import { type Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { validator } from "hono/validator";
import type { AssetBundle } from "../lib/asset_bundle/bundle.ts";
import { handleShellEndpoint } from "./shell_endpoint.ts";
import type { KvPrimitives } from "../lib/data/kv_primitives.ts";
import { compile as gitIgnoreCompiler } from "gitignore-parser";
import { decodePageURI } from "@silverbulletmd/silverbullet/lib/page_ref";
import { LockoutTimer } from "./lockout.ts";
import type { AuthOptions } from "../cmd/server.ts";
import type { ClientConfig } from "../web/client.ts";
import { applyUrlPrefix, removeUrlPrefix } from "../lib/url_prefix.ts";
import { authCookieName, utcDateString } from "./util.ts";
import { renderHtmlPage } from "./serverside_render.ts";
import { FilteredSpacePrimitives } from "../lib/spaces/filtered_space_primitives.ts";
import { AssetBundlePlugSpacePrimitives } from "../lib/spaces/asset_bundle_space_primitives.ts";
import { determineStorageBackend } from "./storage_backend.ts";
import { ReadOnlySpacePrimitives } from "../lib/spaces/ro_space_primitives.ts";
import type { SpacePrimitives } from "../lib/spaces/space_primitives.ts";
import { JWTIssuer } from "./crypto.ts";
import {
  determineShellBackend,
  NotSupportedShell,
  type ShellBackend,
} from "./shell_backend.ts";
import { CONFIG_TEMPLATE, INDEX_TEMPLATE } from "../web/PAGE_TEMPLATES.ts";
import type { FileMeta } from "../type/index.ts";

const authenticationExpirySeconds = 60 * 60 * 24 * 7; // 1 week

export type ServerOptions = {
  hostname: string;
  port: number;
  hostUrlPrefix?: string;
  auth?: AuthOptions;
  spaceIgnore?: string;
  pagesPath: string;
  shellBackend: string;
  readOnly: boolean;
  indexPage: string;
};

export class HttpServer {
  private abortController?: AbortController;
  private hostname: string;
  private port: number;
  private app: Hono;
  private readonly spacePrimitives: SpacePrimitives;
  private jwtIssuer: JWTIssuer;
  private readonly shellBackend: ShellBackend;

  constructor(
    readonly options: ServerOptions,
    private clientAssetBundle: AssetBundle,
    private plugAssetBundle: AssetBundle,
    public baseKvPrimitives: KvPrimitives,
  ) {
    this.app = new Hono().basePath(options.hostUrlPrefix ?? "");
    this.hostname = options.hostname;
    this.port = options.port;

    let fileFilterFn: (s: string) => boolean = () => true;
    if (options.spaceIgnore) {
      fileFilterFn = gitIgnoreCompiler(options.spaceIgnore).accepts;
    }

    this.spacePrimitives = new FilteredSpacePrimitives(
      new AssetBundlePlugSpacePrimitives(
        determineStorageBackend(options.pagesPath),
        this.plugAssetBundle,
      ),
      (meta) => fileFilterFn(meta.name),
    );

    if (options.readOnly) {
      this.spacePrimitives = new ReadOnlySpacePrimitives(this.spacePrimitives);
    }
    this.shellBackend = options.readOnly
      ? new NotSupportedShell() // No shell for read only mode
      : determineShellBackend(options);
    this.jwtIssuer = new JWTIssuer(baseKvPrimitives);
  }

  async start() {
    if (this.options.auth) {
      // Initialize JWT issuer
      await this.jwtIssuer.init(
        JSON.stringify({ auth: this.options.auth }),
      );
    }
    await this.ensureBasicPages();
    // Serve static files (javascript, css, html)
    this.serveStatic();
    this.addAuth();
    this.addFsRoutes();

    // Fallback, serve the UI index.html
    this.app.use("*", (c) => {
      const url = new URL(this.unprefixedUrl(c.req.url));
      const pageName = decodePageURI(url.pathname.slice(1));
      return renderHtmlPage(
        this.spacePrimitives,
        pageName,
        c,
        this.options,
        this.clientAssetBundle,
      );
    });

    this.abortController = new AbortController();
    const listenOptions: any = {
      hostname: this.hostname,
      port: this.port,
      signal: this.abortController.signal,
    };

    // Start the actual server
    Deno.serve(listenOptions, this.app.fetch);

    const visibleHostname = this.hostname === "0.0.0.0"
      ? "localhost"
      : this.hostname;
    console.log(
      `SilverBullet is now running: http://${visibleHostname}:${this.port}`,
    );
  }

  serveStatic() {
    this.app.use("*", (c, next): Promise<void | Response> => {
      const req = c.req;
      const url = new URL(this.unprefixedUrl(req.url));
      if (
        url.pathname === "/"
      ) {
        // Serve the UI (index.html)
        const indexPage = this.options.indexPage ?? "index";
        return renderHtmlPage(
          this.spacePrimitives,
          indexPage,
          c,
          this.options,
          this.clientAssetBundle,
        );
      }
      try {
        const assetName = url.pathname.slice(1);
        if (!this.clientAssetBundle.has(assetName)) {
          return next();
        }
        if (
          this.clientAssetBundle.has(assetName) &&
          req.header("If-Modified-Since") ===
            utcDateString(this.clientAssetBundle.getMtime(assetName))
        ) {
          return Promise.resolve(c.body(null, 304));
        }
        c.status(200);
        c.header("Content-type", this.clientAssetBundle.getMimeType(assetName));
        const data = this.clientAssetBundle.readFileSync(
          assetName,
        );
        c.header("Content-length", "" + data.length);
        c.header(
          "Last-Modified",
          utcDateString(this.clientAssetBundle.getMtime(assetName)),
        );

        if (req.method === "GET") {
          return Promise.resolve(c.body(new Uint8Array(data).buffer));
        } // else e.g. HEAD, OPTIONS, don't send body
      } catch {
        return next();
      }
      return Promise.resolve();
    });
  }

  stop() {
    if (this.abortController) {
      this.abortController.abort();
      console.log("stopped server");
    }
  }

  private addAuth() {
    const excludedPaths = [
      "/manifest.json",
      "/favicon.png",
      "/logo.png",
      "/.auth",
    ];

    // Since we're a single user app, we can use a single lockout timer to prevent brute force attacks
    const lockoutTimer = this.options.auth?.lockoutLimit
      ? new LockoutTimer(
        // Turn into ms
        this.options.auth.lockoutTime * 1000,
        this.options.auth.lockoutLimit!,
      )
      : new LockoutTimer(0, 0); // disabled

    this.app.get("/.logout", (c) => {
      const url = new URL(this.unprefixedUrl(c.req.url));
      deleteCookie(c, authCookieName(url.host), {
        path: `${this.options.hostUrlPrefix ?? ""}/`,
      });
      deleteCookie(c, "refreshLogin", {
        path: `${this.options.hostUrlPrefix ?? ""}/`,
      });

      return c.redirect(this.prefixedUrl("/.auth"));
    });

    // Authentication endpoints
    this.app.get("/.auth", (c) => {
      const html = this.clientAssetBundle.readTextFileSync(".client/auth.html")
        .replaceAll("{{HOST_URL_PREFIX}}", this.options.hostUrlPrefix ?? "");

      return c.html(html);
    }).post(
      validator("form", (value: any, c: Context) => {
        const username = value["username"];
        const password = value["password"];
        const rememberMe = value["rememberMe"];

        if (
          !username || typeof username !== "string" ||
          !password || typeof password !== "string" ||
          (rememberMe && typeof rememberMe !== "string")
        ) {
          return c.redirect(this.prefixedUrl("/.auth?error=0"));
        }

        return { username, password, rememberMe };
      }),
      async (c) => {
        const req = c.req;
        const url = new URL(this.unprefixedUrl(req.url));
        const { username, password, rememberMe } = req.valid("form");

        const {
          user: expectedUser,
          pass: expectedPassword,
        } = this.options.auth!;

        if (lockoutTimer.isLocked()) {
          console.error("Authentication locked out, redirecting to auth page.");
          return c.redirect(this.prefixedUrl("/.auth?error=2"));
        }

        if (username === expectedUser && password === expectedPassword) {
          // Generate a JWT and set it as a cookie
          const jwt = rememberMe
            ? await this.jwtIssuer.createJWT({ username })
            : await this.jwtIssuer.createJWT(
              { username },
              authenticationExpirySeconds,
            );
          console.log("Successful auth");
          const inAWeek = new Date(
            Date.now() + authenticationExpirySeconds * 1000,
          );
          setCookie(c, authCookieName(url.host), jwt, {
            path: `${this.options.hostUrlPrefix ?? ""}/`,
            expires: inAWeek,
          });
          if (rememberMe) {
            setCookie(c, "refreshLogin", "true", {
              path: `${this.options.hostUrlPrefix ?? ""}/`,
              expires: inAWeek,
            });
          }
          const values = await req.parseBody();
          const from = values["from"];
          return c.redirect(
            this.prefixedUrl(typeof from === "string" ? from : "/"),
          );
        } else {
          console.error("Authentication failed, redirecting to auth page.");
          lockoutTimer.addCount();
          return c.redirect(this.prefixedUrl("/.auth?error=1"));
        }
      },
    ).all((c) => {
      return c.redirect(this.prefixedUrl("/.auth"));
    });

    // Check auth on every other request
    this.app.use("*", async (c, next) => {
      if (!this.options.auth) {
        // Auth disabled in this config, skip
        return next();
      }
      const req = c.req;
      const url = new URL(this.unprefixedUrl(req.url));
      const path = this.unprefixedUrl(req.path);
      const host = url.host;
      const redirectToAuth = () => {
        // Try filtering api paths
        if (path.startsWith("/.") || path.endsWith(".md")) {
          return c.redirect(this.prefixedUrl("/.auth"), 401 as any);
        } else {
          return c.redirect(
            this.prefixedUrl(`/.auth?from=${path}`),
            302 as any,
          );
        }
      };
      if (!excludedPaths.includes(url.pathname)) {
        const authCookie = getCookie(c, authCookieName(host));

        if (!authCookie && this.options.auth?.authToken) {
          // Attempt Bearer Authorization based authentication
          const authHeader = req.header("Authorization");
          if (authHeader && authHeader.startsWith("Bearer ")) {
            const authToken = authHeader.slice("Bearer ".length);
            if (authToken === this.options.auth.authToken) {
              // All good, let's proceed
              this.refreshLogin(c, host);
              return next();
            } else {
              console.log(
                "Unauthorized token access, redirecting to auth page",
              );
              return c.text("Unauthorized", 401);
            }
          }
        }
        if (!authCookie) {
          console.log("Unauthorized access, redirecting to auth page");
          return redirectToAuth();
        }
        const { user: expectedUser } = this.options.auth!;

        try {
          const verifiedJwt = await this.jwtIssuer
            .verifyAndDecodeJWT(
              authCookie,
            );
          if (verifiedJwt.username !== expectedUser) {
            throw new Error("Username mismatch");
          }
        } catch (e: any) {
          console.error(
            "Error verifying JWT, redirecting to auth page",
            e.message,
          );
          return redirectToAuth();
        }
      }
      this.refreshLogin(c, host);
      return next();
    });

    // Fetch config
    this.app.get("/.config", (c) => {
      const clientConfig: ClientConfig = {
        readOnly: this.options.readOnly,
        spaceFolderPath: this.options.pagesPath,
        indexPage: this.options.indexPage,
      };
      return c.json(clientConfig, 200, {
        "Cache-Control": "no-cache",
      });
    });

    // Simple ping health endpoint
    this.app.get("/.ping", (c) => {
      return c.text("OK", 200, {
        "Cache-Control": "no-cache",
      });
    });

    // Shell command endpoint
    this.app.post("/.shell", (c) => {
      return handleShellEndpoint(
        c,
        this.shellBackend,
        this.options.readOnly,
      );
    });

    // HTTP Proxy endpoint
    const proxyPathRegex = "/.proxy/:uri{.+}";
    this.app.all(
      proxyPathRegex,
      async (c) => {
        const req = c.req;
        if (this.options.readOnly) {
          return c.text("Read only mode, no proxy allowed", 405);
        }

        // Get the full URL including query parameters
        const originalUrl = new URL(req.url);
        let url = req.param("uri")! + originalUrl.search;

        // Assume https unless this is localhost or an IP address
        if (
          url.startsWith("localhost") || url.match(/^\d+\./)
        ) {
          url = `http://${url}`;
        } else {
          url = `https://${url}`;
        }
        console.log("Proxying to", url);
        try {
          const safeRequestHeaders = new Headers();
          // List all headers
          for (
            const headerName of ["Authorization", "Accept", "Content-Type"]
          ) {
            if (req.header(headerName)) {
              safeRequestHeaders.set(
                headerName,
                req.header(headerName)!,
              );
            }
          }
          // List all headers starting with X-Proxy-Header-, remove the prefix and add to the safe headers
          for (const [key, value] of Object.entries(req.header())) {
            if (key.startsWith("x-proxy-header-")) {
              safeRequestHeaders.set(
                key.slice("x-proxy-header-".length), // corrected casing of header prefix
                value,
              );
            }
          }
          const body = await req.arrayBuffer();
          return fetch(url, {
            method: req.method,
            headers: safeRequestHeaders,
            body: body.byteLength > 0 ? body : undefined,
          });
        } catch (e: any) {
          console.error("Error fetching federated link", e);
          return c.text(e.message, 500);
        }
      },
    );
  }

  private refreshLogin(c: Context, host: string) {
    if (getCookie(c, "refreshLogin")) {
      const inAWeek = new Date(
        Date.now() + authenticationExpirySeconds * 1000,
      );
      const jwt = getCookie(c, authCookieName(host));
      if (jwt) {
        setCookie(c, authCookieName(host), jwt, {
          path: `${this.options.hostUrlPrefix ?? ""}/`,
          expires: inAWeek,
          // sameSite: "Strict",
          // httpOnly: true,
        });
        setCookie(c, "refreshLogin", "true", {
          path: `${this.options.hostUrlPrefix ?? ""}/`,
          expires: inAWeek,
        });
      }
    }
  }

  private addFsRoutes() {
    // File list
    this.app.get("/index.json", async (c) => {
      const req = c.req;
      if (req.header("X-Sync-Mode")) {
        // Only handle direct requests for a JSON representation of the file list
        const files = await this.spacePrimitives.fetchFileList();
        return c.json(files, 200, {
          "X-Space-Path": this.options.pagesPath,
        });
      } else {
        // Otherwise, redirect to the UI
        // The reason to do this is to handle authentication systems like Authelia nicely
        return c.redirect(this.prefixedUrl("/"));
      }
    });

    const filePathRegex = "/:path{[^!].*\\.[a-zA-Z0-9]+}";
    const mdExt = ".md";

    this.app.get(filePathRegex, async (c, next) => {
      const req = c.req;
      const name = req.param("path")!;
      console.log("Requested file", name);

      if (
        name.endsWith(mdExt) &&
        // This header signififies the requests comes directly from the http_space_primitives client (not the browser)
        !req.header("X-Sync-Mode") &&
        req.header("sec-fetch-mode") !== "cors"
      ) {
        // It can happen that during a sync, authentication expires, this may result in a redirect to the login page and then back to this particular file. This particular file may be an .md file, which isn't great to show so we're redirecting to the associated SB UI page.
        console.warn(
          "Request was without X-Sync-Mode nor a CORS request, redirecting to page",
        );
        return c.redirect(this.prefixedUrl(`/${name.slice(0, -mdExt.length)}`));
      }
      // This is a good guess that the request comes directly from a user
      if (
        req.header("Accept")?.includes("text/html") &&
        req.query("raw") !== "true"
      ) {
        return next();
      }

      if (name.startsWith(".")) {
        // Don't expose hidden files
        return c.notFound();
      }

      try {
        if (req.header("X-Get-Meta")) {
          // Getting meta via GET request
          const fileData = await this.spacePrimitives.getFileMeta(
            name,
          );
          return c.text("", 200, this.fileMetaToHeaders(fileData));
        }
        const fileData = await this.spacePrimitives.readFile(name);
        const lastModifiedHeader = new Date(fileData.meta.lastModified)
          .toUTCString();
        if (
          req.header("If-Modified-Since") === lastModifiedHeader
        ) {
          return c.body(null, 304);
        }
        return c.body(new Uint8Array(fileData.data).buffer, 200, {
          ...this.fileMetaToHeaders(fileData.meta),
          "Last-Modified": lastModifiedHeader,
        });
      } catch (e: any) {
        console.error("Error GETting file", name, e.message);
        return c.notFound();
      }
    }).put(
      async (c) => {
        const req = c.req;
        const name = req.param("path")!;
        if (this.options.readOnly) {
          return c.text("Read only mode, no writes allowed", 405);
        }
        console.log("Writing file", name);
        if (name.startsWith(".")) {
          // Don't expose hidden files
          return c.text("Forbidden", 403);
        }

        const body = await req.arrayBuffer();

        try {
          const meta = await this.spacePrimitives.writeFile(
            name,
            new Uint8Array(body),
          );
          return c.text("OK", 200, this.fileMetaToHeaders(meta));
        } catch (err) {
          console.error("Write failed", err);
          return c.text("Write failed", 500);
        }
      },
    ).delete(async (c) => {
      const req = c.req;
      const name = req.param("path")!;
      if (this.options.readOnly) {
        return c.text("Read only mode, no writes allowed", 405);
      }
      console.log("Deleting file", name);
      if (name.startsWith(".")) {
        // Don't expose hidden files
        return c.text("Forbidden", 403);
      }
      try {
        await this.spacePrimitives.deleteFile(name);
        return c.text("OK");
      } catch (e: any) {
        console.error("Error deleting document", e);
        return c.text(e.message, 500);
      }
    }).options();
  }

  private fileMetaToHeaders(fileMeta: FileMeta) {
    return {
      "Content-Type": fileMeta.contentType,
      "X-Last-Modified": "" + fileMeta.lastModified,
      "X-Created": "" + fileMeta.created,
      "Cache-Control": "no-cache",
      "X-Permission": fileMeta.perm,
      "X-Content-Length": "" + fileMeta.size,
    };
  }

  private prefixedUrl(url: string): string {
    return applyUrlPrefix(url, this.options.hostUrlPrefix);
  }

  private unprefixedUrl(url: string): string {
    return removeUrlPrefix(url, this.options.hostUrlPrefix);
  }

  async ensureBasicPages() {
    await this.ensurePageWithContent(
      `${this.options.indexPage}.md`,
      INDEX_TEMPLATE,
    );

    const files = await this.spacePrimitives.fetchFileList();
    const hasConfig = files.some(
      (f) => f.name === "CONFIG.md" || f.name.endsWith("/CONFIG.md"),
    );
    if (!hasConfig) {
      await this.ensurePageWithContent("CONFIG.md", CONFIG_TEMPLATE);
    }
  }

  private async ensurePageWithContent(path: string, content: string) {
    try {
      // This will blow up if the page doesn't exist
      await this.spacePrimitives.getFileMeta(path);
    } catch (e: any) {
      if (e.message === "Not found") {
        console.info(path, "page not found, creating...");
        await this.spacePrimitives.writeFile(
          path,
          new TextEncoder().encode(content),
        );
      } else {
        throw e;
      }
    }
  }
}
