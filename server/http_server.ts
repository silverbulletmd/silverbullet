import { deleteCookie, getCookie, setCookie } from "hono/helper.ts";
import { cors } from "hono/middleware.ts";
import { type Context, Hono, type HonoRequest } from "hono/mod.ts";
import { AssetBundle } from "../lib/asset_bundle/bundle.ts";
import { FileMeta } from "../plug-api/types.ts";
import { ShellRequest } from "../type/rpc.ts";
import { SpaceServer, SpaceServerConfig } from "./instance.ts";
import { KvPrimitives } from "$lib/data/kv_primitives.ts";
import { PrefixedKvPrimitives } from "$lib/data/prefixed_kv_primitives.ts";
import { extendedMarkdownLanguage } from "$common/markdown_parser/parser.ts";
import { parse } from "$common/markdown_parser/parse_tree.ts";
import { renderMarkdownToHtml } from "../plugs/markdown/markdown_render.ts";
import { parsePageRef } from "$sb/lib/page_ref.ts";
import { base64Encode } from "$lib/crypto.ts";
import * as path from "$std/path/mod.ts";

const authenticationExpirySeconds = 60 * 60 * 24 * 7; // 1 week

export type ServerOptions = {
  hostname: string;
  port: number;
  clientAssetBundle: AssetBundle;
  plugAssetBundle: AssetBundle;
  baseKvPrimitives: KvPrimitives;
  certFile?: string;
  keyFile?: string;

  configs: Map<string, SpaceServerConfig>;
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

  spaceServers = new Map<string, Promise<SpaceServer>>();
  baseKvPrimitives: KvPrimitives;
  configs: Map<string, SpaceServerConfig>;

  constructor(options: ServerOptions) {
    this.app = new Hono();
    this.clientAssetBundle = options.clientAssetBundle;
    this.plugAssetBundle = options.plugAssetBundle;
    this.hostname = options.hostname;
    this.port = options.port;
    this.keyFile = options.keyFile;
    this.certFile = options.certFile;
    this.baseKvPrimitives = options.baseKvPrimitives;
    this.configs = options.configs;
  }

  async bootSpaceServer(config: SpaceServerConfig): Promise<SpaceServer> {
    const spaceServer = new SpaceServer(
      config,
      this.plugAssetBundle,
      new PrefixedKvPrimitives(this.baseKvPrimitives, [
        config.namespace,
      ]),
    );
    await spaceServer.init();

    return spaceServer;
  }

  determineConfig(req: HonoRequest): [string, SpaceServerConfig] {
    const url = new URL(req.url);
    let hostname = url.host; // hostname:port

    // First try a full match
    let config = this.configs.get(hostname);
    if (config) {
      return [hostname, config];
    }

    // Then rip off the port and try again
    hostname = hostname.split(":")[0];
    config = this.configs.get(hostname);
    if (config) {
      return [hostname, config];
    }

    // If all else fails, try the wildcard
    config = this.configs.get("*");

    if (config) {
      return ["*", config];
    }

    throw new Error(`No space server config found for hostname ${hostname}`);
  }

  ensureSpaceServer(req: HonoRequest): Promise<SpaceServer> {
    const [matchedHostname, config] = this.determineConfig(req);
    const spaceServer = this.spaceServers.get(matchedHostname);
    if (spaceServer) {
      return spaceServer;
    }
    // And then boot the thing, async
    const spaceServerPromise = this.bootSpaceServer(config);
    // But immediately write the promise to the map so that we don't boot it twice
    this.spaceServers.set(matchedHostname, spaceServerPromise);
    return spaceServerPromise;
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
      ).replace(
        "{{CLIENT_ENCRYPTION}}",
        spaceServer.clientEncryption ? "true" : "false",
      );
    return c.html(
      html,
      200,
      {
        "Last-Modified": lastModified,
      },
    );
  }

  start() {
    // Serve static files (javascript, css, html)
    this.serveStatic();
    this.addAuth();
    this.addFsRoutes();

    // Fallback, serve the UI index.html
    this.app.use("*", async (c) => {
      const spaceServer = await this.ensureSpaceServer(c.req);
      const url = new URL(c.req.url);
      const pageName = decodeURI(url.pathname.slice(1));
      return this.renderHtmlPage(spaceServer, pageName, c);
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

  serveStatic() {
    this.app.use("*", async (c, next) => {
      const req = c.req;
      const spaceServer = await this.ensureSpaceServer(req);
      const url = new URL(req.url);
      // console.log("URL", url);
      if (
        url.pathname === "/"
      ) {
        // Serve the UI (index.html)
        const indexPage = parsePageRef(spaceServer.settings?.indexPage!).page;
        return this.renderHtmlPage(spaceServer, indexPage, c);
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
          return c.body(null, 304);
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
                  spaceServer.clientEncryption,
                  spaceServer.syncOnly,
                  spaceServer.readOnly,
                  spaceServer.enableSpaceScript,
                ]),
              ),
            );
          }
          return c.body(data);
        } // else e.g. HEAD, OPTIONS, don't send body
      } catch {
        return next();
      }
    });
  }

  private addAuth() {
    const excludedPaths = [
      "/manifest.json",
      "/favicon.png",
      "/logo.png",
      "/.auth",
    ];

    // Middleware handling the /.auth page and flow
    this.app.all("/.auth", async (c) => {
      const url = new URL(c.req.url);
      const req = c.req;
      const host = url.host; // e.g. localhost:3000
      if (url.search === "?logout") {
        deleteCookie(c, authCookieName(host));
      }
      if (req.method === "GET") {
        return c.html(
          this.clientAssetBundle.readTextFileSync(".client/auth.html"),
        );
      } else if (req.method === "POST") {
        const values = await c.req.parseBody();
        const username = values["username"];
        const password = values["password"];
        const spaceServer = await this.ensureSpaceServer(req);
        const { user: expectedUser, pass: expectedPassword } = spaceServer
          .auth!;
        if (username === expectedUser && password === expectedPassword) {
          // Generate a JWT and set it as a cookie
          const jwt = await spaceServer.jwtIssuer.createJWT(
            { username },
            authenticationExpirySeconds,
          );
          console.log("Successful auth");
          setCookie(c, authCookieName(host), jwt, {
            expires: new Date(
              Date.now() + authenticationExpirySeconds * 1000,
            ), // in a week
            // sameSite: "Strict",
            // httpOnly: true,
          });
          return c.redirect("/");
        } else {
          return c.redirect("/.auth?error=1");
        }
      } else {
        return c.redirect("/.auth");
      }
    });

    // Check auth
    this.app.use("*", async (c, next) => {
      const req = c.req;
      const spaceServer = await this.ensureSpaceServer(req);
      if (!spaceServer.auth && !spaceServer.authToken) {
        // Auth disabled in this config, skip
        return next();
      }
      const url = new URL(req.url);
      const host = url.host;
      if (!excludedPaths.includes(url.pathname)) {
        const authCookie = getCookie(c, authCookieName(host));

        if (!authCookie && spaceServer.authToken) {
          // Attempt Bearer Authorization based authentication
          const authHeader = req.header("Authorization");
          if (authHeader && authHeader.startsWith("Bearer ")) {
            const authToken = authHeader.slice("Bearer ".length);
            if (authToken === spaceServer.authToken) {
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
          return c.redirect("/.auth");
        }
        const { user: expectedUser } = spaceServer.auth!;

        try {
          const verifiedJwt = await spaceServer.jwtIssuer.verifyAndDecodeJWT(
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
          return c.redirect("/.auth");
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
    this.app.get(
      "/index.json",
      async (c) => {
        const req = c.req;
        const spaceServer = await this.ensureSpaceServer(req);
        if (req.header("X-Sync-Mode")) {
          // Only handle direct requests for a JSON representation of the file list
          const files = await spaceServer.spacePrimitives.fetchFileList();
          return c.json(files, 200, {
            "X-Space-Path": spaceServer.pagesPath,
          });
        } else {
          // Otherwise, redirect to the UI
          // The reason to do this is to handle authentication systems like Authelia nicely
          return c.redirect("/");
        }
      },
    );

    // RPC shell
    this.app.post("/.rpc/shell", async (c) => {
      const req = c.req;
      const spaceServer = await this.ensureSpaceServer(req);
      const body = await req.json();
      try {
        const shellCommand: ShellRequest = body;
        const shellResponse = await spaceServer.shellBackend.handle(
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
      const spaceServer = await this.ensureSpaceServer(req);
      const body = await req.json();
      try {
        if (spaceServer.syncOnly) {
          return c.text("Sync only mode, no syscalls allowed", 400);
        }
        const args: string[] = body;
        try {
          const result = await spaceServer.system!.syscall(
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

    const filePathRegex = "/:path{[^!].*\\.[a-zA-Z]+}";
    const mdExt = ".md";

    this.app.get(
      filePathRegex,
      async (c) => {
        const req = c.req;
        const name = req.param("path")!;
        const spaceServer = await this.ensureSpaceServer(req);
        console.log(
          "Requested file",
          name,
        );
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
          return c.redirect(`/${name.slice(0, -mdExt.length)}`, 401);
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

        const filename = path.posix.basename(name, mdExt);
        if (filename.trim() !== filename) {
          const newName = path.posix.join(
            path.posix.dirname(name),
            filename.trim(),
          );
          return c.redirect(`/${newName}`);
        }

        try {
          if (req.header("X-Get-Meta")) {
            // Getting meta via GET request
            const fileData = await spaceServer.spacePrimitives.getFileMeta(
              name,
            );
            return c.text("", 200, this.fileMetaToHeaders(fileData));
          }
          const fileData = await spaceServer.spacePrimitives.readFile(name);
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
      },
    ).put(
      async (c) => {
        const req = c.req;
        const name = req.param("path")!;
        const spaceServer = await this.ensureSpaceServer(req);
        if (spaceServer.readOnly) {
          return c.text("Read only mode, no writes allowed", 405);
        }
        console.log("Writing file", name);
        if (name.startsWith(".")) {
          // Don't expose hidden files
          return c.text("Forbidden", 403);
        }

        const filename = path.posix.basename(name, mdExt);
        if (filename.trim() !== filename) {
          return c.text("Malformed filename", 400);
        }

        const body = await req.arrayBuffer();

        try {
          const meta = await spaceServer.spacePrimitives.writeFile(
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
      const spaceServer = await this.ensureSpaceServer(req);
      if (spaceServer.readOnly) {
        return c.text("Read only mode, no writes allowed", 405);
      }
      console.log("Deleting file", name);
      if (name.startsWith(".")) {
        // Don't expose hidden files
        return c.text("Forbidden", 403);
      }
      try {
        await spaceServer.spacePrimitives.deleteFile(name);
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
        const spaceServer = await this.ensureSpaceServer(req);
        if (spaceServer.readOnly) {
          return c.text("Read only mode, no federation proxy allowed", 405);
        }
        let url = req.param("uri")!.slice(1);
        if (!req.header("X-Proxy-Request")) {
          // Direct browser request, not explicity fetch proxy request
          if (!/\.[a-zA-Z0-9]+$/.test(url)) {
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
