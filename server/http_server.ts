import { deleteCookie, getCookie, setCookie } from "hono/helper.ts";
import { cors } from "hono/middleware.ts";
import { type Context, Hono, validator } from "hono/mod.ts";
import type { AssetBundle } from "$lib/asset_bundle/bundle.ts";
import type {
  EndpointRequest,
  EndpointResponse,
  FileMeta,
} from "@silverbulletmd/silverbullet/types";
import type { ShellRequest } from "@silverbulletmd/silverbullet/type/rpc";
import { SpaceServer } from "./space_server.ts";
import type { KvPrimitives } from "$lib/data/kv_primitives.ts";
import { PrefixedKvPrimitives } from "$lib/data/prefixed_kv_primitives.ts";
import { extendedMarkdownLanguage } from "$common/markdown_parser/parser.ts";
import { parse } from "$common/markdown_parser/parse_tree.ts";
import { renderMarkdownToHtml } from "../plugs/markdown/markdown_render.ts";
import {
  looksLikePathWithExtension,
  parsePageRef,
} from "@silverbulletmd/silverbullet/lib/page_ref";
import { base64Encode } from "$lib/crypto.ts";
import { basename, dirname, join } from "@std/path";

const authenticationExpirySeconds = 60 * 60 * 24 * 7; // 1 week

export type ServerOptions = {
  hostname: string;
  port: number;
  clientAssetBundle: AssetBundle;
  plugAssetBundle: AssetBundle;
  baseKvPrimitives: KvPrimitives;
  certFile?: string;
  keyFile?: string;

  // Enable username/password auth
  auth?: { user: string; pass: string };
  // Additional API auth token
  authToken?: string;
  pagesPath: string;
  shellBackend: string;
  syncOnly: boolean;
  readOnly: boolean;
  enableSpaceScript: boolean;
};

export class HttpServer {
  abortController?: AbortController;
  clientAssetBundle: AssetBundle;
  plugAssetBundle: AssetBundle;
  hostname: string;
  port: number;
  app: Hono;
  keyFile: string | undefined;
  certFile: string | undefined;

  // Available after start()
  spaceServer!: SpaceServer;
  baseKvPrimitives: KvPrimitives;

  constructor(private options: ServerOptions) {
    this.app = new Hono();
    this.clientAssetBundle = options.clientAssetBundle;
    this.plugAssetBundle = options.plugAssetBundle;
    this.hostname = options.hostname;
    this.port = options.port;
    this.keyFile = options.keyFile;
    this.certFile = options.certFile;
    this.baseKvPrimitives = options.baseKvPrimitives;
  }

  // Replaces some template variables in index.html in a rather ad-hoc manner, but YOLO
  async renderHtmlPage(
    spaceServer: SpaceServer,
    pageName: string,
    c: Context,
  ): Promise<Response> {
    let html = "";
    let lastModified = utcDateString(Date.now());
    if (!spaceServer.auth) {
      // Only attempt server-side rendering when this site is not protected by auth
      try {
        const { data, meta } = await spaceServer.spacePrimitives.readFile(
          `${pageName}.md`,
        );
        lastModified = utcDateString(meta.lastModified);

        if (c.req.header("If-Modified-Since") === lastModified) {
          // Not modified, empty body status 304
          return c.body(null, 304);
        }
        const text = new TextDecoder().decode(data);
        const tree = parse(extendedMarkdownLanguage, text);
        html = renderMarkdownToHtml(tree);
      } catch (e: any) {
        if (e.message !== "Not found") {
          console.error("Error server-side rendering page", e);
        }
      }
    }
    // TODO: Replace this with a proper template engine
    html = this.clientAssetBundle.readTextFileSync(".client/index.html")
      .replace(
        "{{SPACE_PATH}}",
        spaceServer.pagesPath.replaceAll("\\", "\\\\"),
      )
      .replace(
        "{{DESCRIPTION}}",
        JSON.stringify(stripHtml(html).substring(0, 255)),
      )
      .replace(
        "{{TITLE}}",
        pageName,
      ).replace(
        "{{SYNC_ONLY}}",
        spaceServer.syncOnly ? "true" : "false",
      ).replace(
        "{{ENABLE_SPACE_SCRIPT}}",
        spaceServer.enableSpaceScript ? "true" : "false",
      ).replace(
        "{{READ_ONLY}}",
        spaceServer.readOnly ? "true" : "false",
      ).replace(
        "{{CONTENT}}",
        html,
      );
    return c.html(
      html,
      200,
      {
        "Last-Modified": lastModified,
      },
    );
  }

  async start() {
    // Serve static files (javascript, css, html)
    this.serveStatic();
    this.serveCustomEndpoints();
    this.addAuth();
    this.addFsRoutes();

    // Boot space server
    this.spaceServer = new SpaceServer(
      this.options,
      this.plugAssetBundle,
      new PrefixedKvPrimitives(this.baseKvPrimitives, ["*"]), // * for backwards compatibility reasons
    );
    await this.spaceServer.init();

    // Fallback, serve the UI index.html
    this.app.use("*", (c) => {
      const url = new URL(c.req.url);
      const pageName = decodeURI(url.pathname.slice(1));
      return this.renderHtmlPage(this.spaceServer, pageName, c);
    });

    this.abortController = new AbortController();
    const listenOptions: any = {
      hostname: this.hostname,
      port: this.port,
      signal: this.abortController.signal,
    };
    if (this.keyFile) {
      listenOptions.key = Deno.readTextFileSync(this.keyFile);
    }
    if (this.certFile) {
      listenOptions.cert = Deno.readTextFileSync(this.certFile);
    }

    // Start the actual server
    Deno.serve(listenOptions, this.app.fetch);

    const visibleHostname = this.hostname === "0.0.0.0"
      ? "localhost"
      : this.hostname;
    console.log(
      `SilverBullet is now running: http://${visibleHostname}:${this.port}`,
    );
  }

  // Custom endpoints can be defined in the server
  serveCustomEndpoints() {
    this.app.use("/_/*", async (ctx) => {
      const req = ctx.req;
      const url = new URL(req.url);
      if (!this.spaceServer.serverSystem) {
        return ctx.text("No server system available", 500);
      }

      try {
        const path = url.pathname.slice(2); // Remove the /_
        const responses: EndpointResponse[] = await this.spaceServer
          .serverSystem
          .eventHook.dispatchEvent(`http:request:${path}`, {
            fullPath: url.pathname,
            path,
            method: req.method,
            body: await req.text(),
            query: Object.fromEntries(
              url.searchParams.entries(),
            ),
            headers: req.header(),
          } as EndpointRequest);
        if (responses.length === 0) {
          return ctx.text(
            "No custom endpoint handler is handling this path",
            404,
          );
        } else if (responses.length > 1) {
          return ctx.text(
            "Multiple endpoint handlers are handling this path, this is not supported",
            500,
          );
        }
        const response = responses[0];
        if (response.headers) {
          for (
            const [key, value] of Object.entries(
              response.headers,
            )
          ) {
            ctx.header(key, value);
          }
        }
        ctx.status(response.status || 200);
        if (typeof response.body === "string") {
          return ctx.text(response.body);
        } else if (response.body instanceof Uint8Array) {
          return ctx.body(response.body);
        } else {
          return ctx.json(response.body);
        }
      } catch (e: any) {
        console.error("HTTP endpoint error", e);
        return ctx.text(e.message, 500);
      }
    });
  }

  serveStatic() {
    this.app.use("*", (c, next): Promise<void | Response> => {
      const req = c.req;
      const url = new URL(req.url);
      // console.log("URL", url);
      if (
        url.pathname === "/"
      ) {
        // Serve the UI (index.html)
        const indexPage =
          parsePageRef(this.spaceServer.config?.indexPage!).page;
        return this.renderHtmlPage(this.spaceServer, indexPage, c);
      }
      try {
        const assetName = url.pathname.slice(1);
        if (!this.clientAssetBundle.has(assetName)) {
          return next();
        }
        if (
          this.clientAssetBundle.has(assetName) &&
          req.header("If-Modified-Since") ===
            utcDateString(this.clientAssetBundle.getMtime(assetName)) &&
          assetName !== "service_worker.js"
        ) {
          return Promise.resolve(c.body(null, 304));
        }
        c.status(200);
        c.header("Content-type", this.clientAssetBundle.getMimeType(assetName));
        let data: Uint8Array | string = this.clientAssetBundle.readFileSync(
          assetName,
        );
        c.header("Content-length", "" + data.length);
        if (assetName !== "service_worker.js") {
          c.header(
            "Last-Modified",
            utcDateString(this.clientAssetBundle.getMtime(assetName)),
          );
        }

        if (req.method === "GET") {
          if (assetName === "service_worker.js") {
            c.header("Cache-Control", "no-cache");
            const textData = new TextDecoder().decode(data);
            // console.log(
            //   "Swapping out config hash in service worker",
            // );
            data = textData.replaceAll(
              "{{CONFIG_HASH}}",
              base64Encode(
                JSON.stringify([
                  this.spaceServer.syncOnly,
                  this.spaceServer.readOnly,
                  this.spaceServer.enableSpaceScript,
                ]),
              ),
            );
          }
          return Promise.resolve(c.body(data));
        } // else e.g. HEAD, OPTIONS, don't send body
      } catch {
        return next();
      }
      return Promise.resolve();
    });
  }

  private addAuth() {
    const excludedPaths = [
      "/manifest.json",
      "/favicon.png",
      "/logo.png",
      "/.auth",
    ];

    // TODO: This should probably be a POST request
    this.app.get("/.logout", (c) => {
      const url = new URL(c.req.url);
      deleteCookie(c, authCookieName(url.host));

      return c.redirect("/.auth");
    });

    this.app.get("/.auth", (c) => {
      const html = this.clientAssetBundle.readTextFileSync(".client/auth.html");

      return c.html(html);
    }).post(
      validator("form", (value, c) => {
        const username = value["username"];
        const password = value["password"];

        if (
          !username || typeof username !== "string" ||
          !password || typeof password !== "string"
        ) {
          return c.redirect("/.auth?error=0");
        }

        return { username, password };
      }),
      async (c) => {
        const req = c.req;
        const url = new URL(c.req.url);
        const { username, password } = req.valid("form");

        const {
          user: expectedUser,
          pass: expectedPassword,
        } = this.spaceServer.auth!;

        if (username === expectedUser && password === expectedPassword) {
          // Generate a JWT and set it as a cookie
          const jwt = await this.spaceServer.jwtIssuer.createJWT(
            { username },
            authenticationExpirySeconds,
          );
          console.log("Successful auth");
          setCookie(c, authCookieName(url.host), jwt, {
            expires: new Date(
              Date.now() + authenticationExpirySeconds * 1000,
            ), // in a week
            // sameSite: "Strict",
            // httpOnly: true,
          });
          const values = await c.req.parseBody();
          const from = values["from"];
          return c.redirect(typeof from === "string" ? from : "/");
        } else {
          console.error("Authentication failed, redirecting to auth page.");
          return c.redirect("/.auth?error=1");
        }
      },
    ).all((c) => {
      return c.redirect("/.auth");
    });

    // Check auth
    this.app.use("*", async (c, next) => {
      const req = c.req;
      if (!this.spaceServer.auth && !this.spaceServer.authToken) {
        // Auth disabled in this config, skip
        return next();
      }
      const url = new URL(req.url);
      const host = url.host;
      const redirectToAuth = () => {
        // Try filtering api paths
        if (req.path.startsWith("/.") || req.path.endsWith(".md")) {
          return c.redirect("/.auth");
        } else {
          return c.redirect(`/.auth?from=${req.path}`);
        }
      };
      if (!excludedPaths.includes(url.pathname)) {
        const authCookie = getCookie(c, authCookieName(host));

        if (!authCookie && this.spaceServer.authToken) {
          // Attempt Bearer Authorization based authentication
          const authHeader = req.header("Authorization");
          if (authHeader && authHeader.startsWith("Bearer ")) {
            const authToken = authHeader.slice("Bearer ".length);
            if (authToken === this.spaceServer.authToken) {
              // All good, let's proceed
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
        const { user: expectedUser } = this.spaceServer.auth!;

        try {
          const verifiedJwt = await this.spaceServer.jwtIssuer
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
      return next();
    });
  }

  private addFsRoutes() {
    this.app.use(
      "*",
      cors({
        origin: "*",
        allowHeaders: ["*"],
        exposeHeaders: ["*"],
        allowMethods: ["GET", "POST", "PUT", "DELETE", "HEAD", "OPTIONS"],
      }),
    );

    // File list
    this.app.get("/index.json", async (c) => {
      const req = c.req;
      if (req.header("X-Sync-Mode")) {
        // Only handle direct requests for a JSON representation of the file list
        const files = await this.spaceServer.spacePrimitives.fetchFileList();
        return c.json(files, 200, {
          "X-Space-Path": this.spaceServer.pagesPath,
        });
      } else {
        // Otherwise, redirect to the UI
        // The reason to do this is to handle authentication systems like Authelia nicely
        return c.redirect("/");
      }
    });

    // Simple ping health endpoint
    this.app.get("/.ping", (c) => {
      return c.text("OK", 200, {
        "Cache-Control": "no-cache",
      });
    });

    // RPC shell
    this.app.post("/.rpc/shell", async (c) => {
      const req = c.req;
      const body = await req.json();
      try {
        const shellCommand: ShellRequest = body;
        const shellResponse = await this.spaceServer.shellBackend.handle(
          shellCommand,
        );
        return c.json(shellResponse);
      } catch (e: any) {
        console.log("Shell error", e);
        return c.text(e.message, 500);
      }
    });

    // RPC syscall
    this.app.post("/.rpc/:plugName/:syscall", async (c) => {
      const req = c.req;
      const syscall = req.param("syscall")!;
      const plugName = req.param("plugName")!;
      const body = await req.json();
      try {
        if (this.spaceServer.syncOnly) {
          return c.text("Sync only mode, no syscalls allowed", 400);
        }
        const args: string[] = body;
        try {
          const result = await this.spaceServer.system!.syscall(
            { plug: plugName === "_" ? undefined : plugName },
            syscall,
            args,
          );
          return c.json({
            result: result,
          });
        } catch (e: any) {
          return c.json({
            error: e.message,
          }, 500);
        }
      } catch (e: any) {
        console.log("Error", e);
        return c.text(e.message, 500);
      }
    });

    const filePathRegex = "/:path{[^!].*\\.[a-zA-Z0-9]+}";
    const mdExt = ".md";

    this.app.get(filePathRegex, async (c) => {
      const req = c.req;
      const name = req.param("path")!;
      console.log("Requested file", name);

      if (
        name.endsWith(mdExt) &&
        // This header signififies the requests comes directly from the http_space_primitives client (not the browser)
        !req.header("X-Sync-Mode") &&
        // This Accept header is used by federation to still work with CORS
        req.header("Accept") !==
          "application/octet-stream" &&
        req.header("sec-fetch-mode") !== "cors"
      ) {
        // It can happen that during a sync, authentication expires, this may result in a redirect to the login page and then back to this particular file. This particular file may be an .md file, which isn't great to show so we're redirecting to the associated SB UI page.
        console.warn(
          "Request was without X-Sync-Mode nor a CORS request, redirecting to page",
        );
        return c.redirect(`/${name.slice(0, -mdExt.length)}`);
      }
      if (name.startsWith(".")) {
        // Don't expose hidden files
        return c.notFound();
      }
      // Handle federated links through a simple redirect, only used for attachments loads with service workers disabled
      if (name.startsWith("!")) {
        let url = name.slice(1);
        console.log("Handling this as a federated link", url);
        if (url.startsWith("localhost")) {
          url = `http://${url}`;
        } else {
          url = `https://${url}`;
        }
        try {
          const req = await fetch(url);
          // Override X-Permssion header to always be "ro"
          const newHeaders = new Headers();
          for (const [key, value] of req.headers.entries()) {
            newHeaders.set(key, value);
          }
          newHeaders.set("X-Permission", "ro");
          return new Response(req.body, {
            status: req.status,
            headers: newHeaders,
          });
        } catch (e: any) {
          console.error("Error fetching federated link", e);
          return c.text(e.message, 500);
        }
      }

      const filename = basename(name, mdExt);
      if (filename.trim() !== filename) {
        const newName = join(
          dirname(name),
          filename.trim(),
        );
        return c.redirect(`/${newName}`);
      }

      try {
        if (req.header("X-Get-Meta")) {
          // Getting meta via GET request
          const fileData = await this.spaceServer.spacePrimitives.getFileMeta(
            name,
          );
          return c.text("", 200, this.fileMetaToHeaders(fileData));
        }
        const fileData = await this.spaceServer.spacePrimitives.readFile(name);
        const lastModifiedHeader = new Date(fileData.meta.lastModified)
          .toUTCString();
        if (
          req.header("If-Modified-Since") === lastModifiedHeader
        ) {
          return c.body(null, 304);
        }
        return c.body(fileData.data, 200, {
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
        if (this.spaceServer.readOnly) {
          return c.text("Read only mode, no writes allowed", 405);
        }
        console.log("Writing file", name);
        if (name.startsWith(".")) {
          // Don't expose hidden files
          return c.text("Forbidden", 403);
        }

        const filename = basename(name, mdExt);
        if (filename.trim() !== filename) {
          return c.text("Malformed filename", 400);
        }

        const body = await req.arrayBuffer();

        try {
          const meta = await this.spaceServer.spacePrimitives.writeFile(
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
      if (this.spaceServer.readOnly) {
        return c.text("Read only mode, no writes allowed", 405);
      }
      console.log("Deleting file", name);
      if (name.startsWith(".")) {
        // Don't expose hidden files
        return c.text("Forbidden", 403);
      }
      try {
        await this.spaceServer.spacePrimitives.deleteFile(name);
        return c.text("OK");
      } catch (e: any) {
        console.error("Error deleting attachment", e);
        return c.text(e.message, 500);
      }
    }).options();

    // Federation proxy
    const proxyPathRegex = "/:uri{!.+}";
    this.app.all(
      proxyPathRegex,
      async (c, next) => {
        const req = c.req;
        if (this.spaceServer.readOnly) {
          return c.text("Read only mode, no federation proxy allowed", 405);
        }
        let url = req.param("uri")!.slice(1);
        if (!req.header("X-Proxy-Request")) {
          // Direct browser request, not explicity fetch proxy request
          if (!looksLikePathWithExtension(url)) {
            console.log("Directly loading federation page via URL:", url);
            // This is not a direct file reference so LIKELY a page request, fall through and load the SB UI
            return next();
          }
        }
        if (url.startsWith("localhost")) {
          url = `http://${url}`;
        } else {
          url = `https://${url}`;
        }
        try {
          const safeRequestHeaders = new Headers();
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
          const body = await req.arrayBuffer();
          const fetchReq = await fetch(url, {
            method: req.method,
            headers: safeRequestHeaders,
            body: body.byteLength > 0 ? body : undefined,
          });
          const responseHeaders: Record<string, any> = {};
          for (const [key, value] of fetchReq.headers.entries()) {
            responseHeaders[key] = value;
          }
          return c.body(fetchReq.body, fetchReq.status, responseHeaders);
        } catch (e: any) {
          console.error("Error fetching federated link", e);
          return c.text(e.message, 500);
        }
      },
    );
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

  stop() {
    if (this.abortController) {
      this.abortController.abort();
      console.log("stopped server");
    }
  }
}

function utcDateString(mtime: number): string {
  return new Date(mtime).toUTCString();
}

function authCookieName(host: string) {
  return `auth_${host.replaceAll(/\W/g, "_")}`;
}

function stripHtml(html: string): string {
  const regex = /<[^>]*>/g;
  return html.replace(regex, "");
}
