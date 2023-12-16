import {
  Application,
  Context,
  Next,
  oakCors,
  Request,
  Router,
} from "./deps.ts";
import { AssetBundle } from "../plugos/asset_bundle/bundle.ts";
import { FileMeta } from "$sb/types.ts";
import { ShellRequest, SyscallRequest, SyscallResponse } from "./rpc.ts";
import { determineShellBackend } from "./shell_backend.ts";
import { SpaceServer, SpaceServerConfig } from "./instance.ts";
import { KvPrimitives } from "../plugos/lib/kv_primitives.ts";
import { EndpointHook } from "../plugos/hooks/endpoint.ts";
import { PrefixedKvPrimitives } from "../plugos/lib/prefixed_kv_primitives.ts";
import { base64Encode } from "../plugos/asset_bundle/base64.ts";

const authenticationExpirySeconds = 60 * 60 * 24 * 7; // 1 week

export type ServerOptions = {
  app: Application;
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
  app: Application<Record<string, any>>;
  keyFile: string | undefined;
  certFile: string | undefined;

  spaceServers = new Map<string, Promise<SpaceServer>>();
  baseKvPrimitives: KvPrimitives;
  configs: Map<string, SpaceServerConfig>;

  constructor(options: ServerOptions) {
    this.clientAssetBundle = options.clientAssetBundle;
    this.plugAssetBundle = options.plugAssetBundle;
    this.hostname = options.hostname;
    this.port = options.port;
    this.app = options.app;
    this.keyFile = options.keyFile;
    this.certFile = options.certFile;
    this.baseKvPrimitives = options.baseKvPrimitives;
    this.configs = options.configs;
  }

  async bootSpaceServer(config: SpaceServerConfig): Promise<SpaceServer> {
    const spaceServer = new SpaceServer(
      config,
      determineShellBackend(config.pagesPath),
      this.plugAssetBundle,
      new PrefixedKvPrimitives(this.baseKvPrimitives, [
        config.namespace,
      ]),
    );
    await spaceServer.init();

    return spaceServer;
  }

  determineConfig(req: Request): [string, SpaceServerConfig] {
    let hostname = req.url.host; // hostname:port

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

  ensureSpaceServer(req: Request): Promise<SpaceServer> {
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
  renderIndexHtml(spaceServer: SpaceServer) {
    return this.clientAssetBundle.readTextFileSync(".client/index.html")
      .replaceAll(
        "{{SPACE_PATH}}",
        spaceServer.pagesPath.replaceAll("\\", "\\\\"),
        // );
      ).replaceAll(
        "{{SYNC_ONLY}}",
        spaceServer.syncOnly ? "true" : "false",
      ).replaceAll(
        "{{CLIENT_ENCRYPTION}}",
        spaceServer.clientEncryption ? "true" : "false",
      );
  }

  start() {
    // Initialize JWT issuer
    // First check if auth string (username:password) has changed
    // Serve static files (javascript, css, html)
    this.app.use(this.serveStatic.bind(this));

    const endpointHook = new EndpointHook("/_/");

    this.app.use(async (context, next) => {
      const spaceServer = await this.ensureSpaceServer(context.request);
      return endpointHook.handleRequest(spaceServer.system!, context, next);
    });

    this.addAuth(this.app);
    const fsRouter = this.addFsRoutes();
    this.app.use(fsRouter.routes());
    this.app.use(fsRouter.allowedMethods());

    // Fallback, serve the UI index.html
    this.app.use(async ({ request, response }) => {
      response.headers.set("Content-type", "text/html");
      response.headers.set("Cache-Control", "no-cache");
      const spaceServer = await this.ensureSpaceServer(request);
      response.body = this.renderIndexHtml(spaceServer);
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
    this.app.listen(listenOptions)
      .catch((e: any) => {
        console.log("Server listen error:", e.message);
        Deno.exit(1);
      });
    const visibleHostname = this.hostname === "0.0.0.0"
      ? "localhost"
      : this.hostname;
    console.log(
      `SilverBullet is now running: http://${visibleHostname}:${this.port}`,
    );
  }

  async serveStatic(
    { request, response }: Context<Record<string, any>, Record<string, any>>,
    next: Next,
  ) {
    const spaceServer = await this.ensureSpaceServer(request);
    if (
      request.url.pathname === "/"
    ) {
      // Serve the UI (index.html)
      // Note: we're explicitly not setting Last-Modified and If-Modified-Since header here because this page is dynamic
      response.headers.set("Content-type", "text/html");
      response.headers.set("Cache-Control", "no-cache");
      response.body = this.renderIndexHtml(spaceServer);
      return;
    }
    try {
      const assetName = request.url.pathname.slice(1);
      if (
        this.clientAssetBundle.has(assetName) &&
        request.headers.get("If-Modified-Since") ===
          utcDateString(this.clientAssetBundle.getMtime(assetName)) &&
        assetName !== "service_worker.js"
      ) {
        response.status = 304;
        return;
      }
      response.status = 200;
      response.headers.set(
        "Content-type",
        this.clientAssetBundle.getMimeType(assetName),
      );
      let data: Uint8Array | string = this.clientAssetBundle.readFileSync(
        assetName,
      );
      response.headers.set("Cache-Control", "no-cache");
      response.headers.set("Content-length", "" + data.length);
      if (assetName !== "service_worker.js") {
        response.headers.set(
          "Last-Modified",
          utcDateString(this.clientAssetBundle.getMtime(assetName)),
        );
      }

      if (request.method === "GET") {
        if (assetName === "service_worker.js") {
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
              ]),
            ),
          );
        }
        response.body = data;
      }
    } catch {
      return next();
    }
  }

  private addAuth(app: Application) {
    const excludedPaths = [
      "/manifest.json",
      "/favicon.png",
      "/logo.png",
      "/.auth",
    ];

    // Middleware handling the /.auth page and flow
    app.use(async ({ request, response, cookies }, next) => {
      const host = request.url.host; // e.g. localhost:3000
      if (request.url.pathname === "/.auth") {
        if (request.url.search === "?logout") {
          await cookies.delete(authCookieName(host));
          // Implicit fallthrough to login page
        }
        if (request.method === "GET") {
          response.headers.set("Content-type", "text/html");
          response.body = this.clientAssetBundle.readTextFileSync(
            ".client/auth.html",
          );
          return;
        } else if (request.method === "POST") {
          const values = await request.body({ type: "form" }).value;
          const username = values.get("username")!;
          const password = values.get("password")!;
          const spaceServer = await this.ensureSpaceServer(request);
          const { user: expectedUser, pass: expectedPassword } = spaceServer
            .auth!;
          if (username === expectedUser && password === expectedPassword) {
            // Generate a JWT and set it as a cookie
            const jwt = await spaceServer.jwtIssuer.createJWT(
              { username },
              authenticationExpirySeconds,
            );
            await cookies.set(
              authCookieName(host),
              jwt,
              {
                expires: new Date(
                  Date.now() + authenticationExpirySeconds * 1000,
                ), // in a week
                sameSite: "strict",
              },
            );
            response.redirect("/");
          } else {
            response.redirect("/.auth?error=1");
          }
          return;
        } else {
          response.redirect("/.auth");
          return;
        }
      } else {
        await next();
      }
    });

    // Check auth
    app.use(async ({ request, response, cookies }, next) => {
      const spaceServer = await this.ensureSpaceServer(request);
      if (!spaceServer.auth) {
        // Auth disabled in this config, skip
        return next();
      }
      const host = request.url.host;
      if (!excludedPaths.includes(request.url.pathname)) {
        const authToken = await cookies.get(authCookieName(host));

        if (!authToken && spaceServer.authToken) {
          // Attempt Bearer Authorization based authentication
          const authHeader = request.headers.get("Authorization");
          if (authHeader && authHeader.startsWith("Bearer ")) {
            const authToken = authHeader.slice("Bearer ".length);
            if (authToken === spaceServer.authToken) {
              // All good, let's proceed
              return next();
            } else {
              console.log(
                "Unauthorized token access, redirecting to auth page",
              );
              response.status = 401;
              response.body = "Unauthorized";
              return;
            }
          }
        }
        if (!authToken) {
          console.log("Unauthorized access, redirecting to auth page");
          return response.redirect("/.auth");
        }
        const { user: expectedUser } = spaceServer.auth!;

        try {
          const verifiedJwt = await spaceServer.jwtIssuer.verifyAndDecodeJWT(
            authToken,
          );
          if (verifiedJwt.username !== expectedUser) {
            throw new Error("Username mismatch");
          }
        } catch (e: any) {
          console.error(
            "Error verifying JWT, redirecting to auth page",
            e.message,
          );
          return response.redirect("/.auth");
        }
      }
      return next();
    });
  }

  private addFsRoutes(): Router {
    const fsRouter = new Router();
    const corsMiddleware = oakCors({
      allowedHeaders: "*",
      exposedHeaders: "*",
      methods: ["GET", "POST", "PUT", "DELETE", "HEAD", "OPTIONS"],
    });

    fsRouter.use(corsMiddleware);

    // File list
    fsRouter.get(
      "/index.json",
      // corsMiddleware,
      async ({ request, response }) => {
        const spaceServer = await this.ensureSpaceServer(request);
        if (request.headers.has("X-Sync-Mode")) {
          // Only handle direct requests for a JSON representation of the file list
          response.headers.set("Content-type", "application/json");
          response.headers.set("X-Space-Path", spaceServer.pagesPath);
          const files = await spaceServer.spacePrimitives.fetchFileList();
          response.body = JSON.stringify(files);
        } else {
          // Otherwise, redirect to the UI
          // The reason to do this is to handle authentication systems like Authelia nicely
          response.redirect("/");
        }
      },
    );

    // RPC
    fsRouter.post("/.rpc", async ({ request, response }) => {
      const spaceServer = await this.ensureSpaceServer(request);
      const body = await request.body({ type: "json" }).value;
      try {
        switch (body.operation) {
          case "shell": {
            const shellCommand: ShellRequest = body;
            const shellResponse = await spaceServer.shellBackend.handle(
              shellCommand,
            );
            response.headers.set("Content-Type", "application/json");
            response.body = JSON.stringify(shellResponse);
            return;
          }
          case "syscall": {
            if (spaceServer.syncOnly) {
              response.headers.set("Content-Type", "text/plain");
              response.status = 400;
              response.body = "Unknown operation";
              return;
            }
            const syscallCommand: SyscallRequest = body;
            try {
              const plug = spaceServer.system!.loadedPlugs.get(
                syscallCommand.ctx,
              );
              if (!plug) {
                throw new Error(`Plug ${syscallCommand.ctx} not found`);
              }
              const result = await plug.syscall(
                syscallCommand.name,
                syscallCommand.args,
              );
              response.headers.set("Content-type", "application/json");
              response.status = 200;
              response.body = JSON.stringify({
                result: result,
              } as SyscallResponse);
            } catch (e: any) {
              response.headers.set("Content-type", "application/json");
              response.status = 500;
              response.body = JSON.stringify({
                error: e.message,
              } as SyscallResponse);
            }
            return;
          }
          default:
            response.headers.set("Content-Type", "text/plain");
            response.status = 400;
            response.body = "Unknown operation";
        }
      } catch (e: any) {
        console.log("Error", e);
        response.status = 500;
        response.body = e.message;
        return;
      }
    });

    const filePathRegex = "\/([^!].+\\.[a-zA-Z]+)";

    fsRouter
      .get(
        filePathRegex,
        async ({ params, response, request }) => {
          const name = params[0];
          const spaceServer = await this.ensureSpaceServer(request);
          console.log("Requested file", name);
          if (!request.headers.has("X-Sync-Mode") && name.endsWith(".md")) {
            // It can happen that during a sync, authentication expires, this may result in a redirect to the login page and then back to this particular file. This particular file may be an .md file, which isn't great to show so we're redirecting to the associated SB UI page.
            console.log("Request was without X-Sync-Mode, redirecting to page");
            response.redirect(`/${name.slice(0, -3)}`);
            return;
          }
          if (name.startsWith(".")) {
            // Don't expose hidden files
            response.status = 404;
            response.body = "Not exposed";
            return;
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
              response.status = req.status;
              // Override X-Permssion header to always be "ro"
              const newHeaders = new Headers();
              for (const [key, value] of req.headers.entries()) {
                newHeaders.set(key, value);
              }
              newHeaders.set("X-Permission", "ro");
              response.headers = newHeaders;
              response.body = req.body;
            } catch (e: any) {
              console.error("Error fetching federated link", e);
              response.status = 500;
              response.body = e.message;
            }
            return;
          }
          try {
            if (request.headers.has("X-Get-Meta")) {
              // Getting meta via GET request
              const fileData = await spaceServer.spacePrimitives.getFileMeta(
                name,
              );
              response.status = 200;
              this.fileMetaToHeaders(response.headers, fileData);
              response.body = "";
              return;
            }
            const fileData = await spaceServer.spacePrimitives.readFile(name);
            const lastModifiedHeader = new Date(fileData.meta.lastModified)
              .toUTCString();
            if (
              request.headers.get("If-Modified-Since") === lastModifiedHeader
            ) {
              response.status = 304;
              return;
            }
            response.status = 200;
            this.fileMetaToHeaders(response.headers, fileData.meta);
            response.headers.set("Last-Modified", lastModifiedHeader);

            response.body = fileData.data;
          } catch (e: any) {
            console.error("Error GETting file", name, e.message);
            response.status = 404;
            response.headers.set("Cache-Control", "no-cache");
            response.body = "Not found";
          }
        },
      )
      .put(
        filePathRegex,
        async ({ request, response, params }) => {
          const name = params[0];
          const spaceServer = await this.ensureSpaceServer(request);
          console.log("Saving file", name);
          if (name.startsWith(".")) {
            // Don't expose hidden files
            response.status = 403;
            return;
          }

          const body = await request.body({ type: "bytes" }).value;

          try {
            const meta = await spaceServer.spacePrimitives.writeFile(
              name,
              body,
            );
            response.status = 200;
            this.fileMetaToHeaders(response.headers, meta);
            response.body = "OK";
          } catch (err) {
            console.error("Write failed", err);
            response.status = 500;
            response.body = "Write failed";
          }
        },
      )
      .delete(filePathRegex, async ({ request, response, params }) => {
        const name = params[0];
        const spaceServer = await this.ensureSpaceServer(request);
        console.log("Deleting file", name);
        if (name.startsWith(".")) {
          // Don't expose hidden files
          response.status = 403;
          return;
        }
        try {
          await spaceServer.spacePrimitives.deleteFile(name);
          response.status = 200;
          response.body = "OK";
        } catch (e: any) {
          console.error("Error deleting attachment", e);
          response.status = 500;
          response.body = e.message;
        }
      })
      .options(filePathRegex, corsMiddleware);

    // Federation proxy
    const proxyPathRegex = "\/!(.+)";
    fsRouter.all(
      proxyPathRegex,
      async ({ params, response, request }, next) => {
        let url = params[0];
        if (!request.headers.has("X-Proxy-Request")) {
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
            if (request.headers.has(headerName)) {
              safeRequestHeaders.set(
                headerName,
                request.headers.get(headerName)!,
              );
            }
          }
          const req = await fetch(url, {
            method: request.method,
            headers: safeRequestHeaders,
            body: request.hasBody
              ? request.body({ type: "stream" }).value
              : undefined,
          });
          response.status = req.status;
          response.headers = req.headers;
          response.body = req.body;
        } catch (e: any) {
          console.error("Error fetching federated link", e);
          response.status = 500;
          response.body = e.message;
        }
        return;
      },
    );
    return fsRouter;
  }

  private fileMetaToHeaders(headers: Headers, fileMeta: FileMeta) {
    headers.set("Content-Type", fileMeta.contentType);
    headers.set(
      "X-Last-Modified",
      "" + fileMeta.lastModified,
    );
    headers.set(
      "X-Created",
      "" + fileMeta.created,
    );
    headers.set("Cache-Control", "no-cache");
    headers.set("X-Permission", fileMeta.perm);
    headers.set("X-Content-Length", "" + fileMeta.size);
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
  return `auth:${host}`;
}
