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
import {
  KvPrimitives,
  PrefixedKvPrimitives,
} from "../plugos/lib/kv_primitives.ts";
import { EndpointHook } from "../plugos/hooks/endpoint.ts";
import { hashSHA256 } from "./crypto.ts";

export type ServerOptions = {
  app: Application;
  hostname: string;
  port: number;
  clientAssetBundle: AssetBundle;
  plugAssetBundle: AssetBundle;
  baseKvPrimitives?: KvPrimitives;
  syncOnly: boolean;
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
  syncOnly: boolean;
  baseKvPrimitives?: KvPrimitives;
  configs: Map<string, SpaceServerConfig>;

  constructor(options: ServerOptions) {
    this.clientAssetBundle = options.clientAssetBundle;
    this.plugAssetBundle = options.plugAssetBundle;
    this.hostname = options.hostname;
    this.port = options.port;
    this.app = options.app;
    this.keyFile = options.keyFile;
    this.certFile = options.certFile;
    this.syncOnly = options.syncOnly;
    this.baseKvPrimitives = options.baseKvPrimitives;
    this.configs = options.configs;
  }

  async bootSpaceServer(config: SpaceServerConfig): Promise<SpaceServer> {
    const spaceServer = new SpaceServer(
      config,
      determineShellBackend(config.pagesPath),
      this.plugAssetBundle,
      this.baseKvPrimitives
        ? new PrefixedKvPrimitives(this.baseKvPrimitives, [
          config.namespace,
        ])
        : undefined,
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
  renderIndexHtml(pagesPath: string) {
    return this.clientAssetBundle.readTextFileSync(".client/index.html")
      .replaceAll(
        "{{SPACE_PATH}}",
        pagesPath.replaceAll("\\", "\\\\"),
        // );
      ).replaceAll(
        "{{SYNC_ONLY}}",
        this.syncOnly ? "true" : "false",
      );
  }

  start() {
    // Serve static files (javascript, css, html)
    this.app.use(this.serveStatic.bind(this));

    const endpointHook = new EndpointHook("/_/");

    this.app.use(async (context, next) => {
      const spaceServer = await this.ensureSpaceServer(context.request);
      return endpointHook.handleRequest(spaceServer.system!, context, next);
    });

    this.addPasswordAuth(this.app);
    const fsRouter = this.addFsRoutes();
    this.app.use(fsRouter.routes());
    this.app.use(fsRouter.allowedMethods());

    // Fallback, serve the UI index.html
    this.app.use(async ({ request, response }) => {
      response.headers.set("Content-type", "text/html");
      response.headers.set("Cache-Control", "no-cache");
      const spaceServer = await this.ensureSpaceServer(request);
      response.body = this.renderIndexHtml(spaceServer.pagesPath);
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
    if (
      request.url.pathname === "/"
    ) {
      // Serve the UI (index.html)
      // Note: we're explicitly not setting Last-Modified and If-Modified-Since header here because this page is dynamic
      response.headers.set("Content-type", "text/html");
      response.headers.set("Cache-Control", "no-cache");
      const spaceServer = await this.ensureSpaceServer(request);
      response.body = this.renderIndexHtml(spaceServer.pagesPath);
      return;
    }
    try {
      const assetName = request.url.pathname.slice(1);
      if (
        this.clientAssetBundle.has(assetName) &&
        request.headers.get("If-Modified-Since") ===
          utcDateString(this.clientAssetBundle.getMtime(assetName))
      ) {
        response.status = 304;
        return;
      }
      response.status = 200;
      response.headers.set(
        "Content-type",
        this.clientAssetBundle.getMimeType(assetName),
      );
      const data = this.clientAssetBundle.readFileSync(
        assetName,
      );
      response.headers.set("Cache-Control", "no-cache");
      response.headers.set("Content-length", "" + data.length);
      response.headers.set(
        "Last-Modified",
        utcDateString(this.clientAssetBundle.getMtime(assetName)),
      );

      if (request.method === "GET") {
        response.body = data;
      }
    } catch {
      return next();
    }
  }

  private addPasswordAuth(app: Application) {
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
          const refer = values.get("refer");

          const spaceServer = await this.ensureSpaceServer(request);
          const hashedPassword = await hashSHA256(password);
          const [expectedUser, expectedPassword] = spaceServer.auth!.split(":");
          if (
            username === expectedUser &&
            hashedPassword === await hashSHA256(expectedPassword)
          ) {
            await cookies.set(
              authCookieName(host),
              `${username}:${hashedPassword}`,
              {
                expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7), // in a week
                sameSite: "strict",
              },
            );
            response.redirect(refer || "/");
            // console.log("All headers", request.headers);
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
        const authCookie = await cookies.get(authCookieName(host));
        if (!authCookie) {
          response.redirect("/.auth");
          return;
        }
        const spaceServer = await this.ensureSpaceServer(request);
        const [username, hashedPassword] = authCookie.split(":");
        const [expectedUser, expectedPassword] = spaceServer.auth!.split(
          ":",
        );
        if (
          username !== expectedUser ||
          hashedPassword !== await hashSHA256(expectedPassword)
        ) {
          response.redirect("/.auth");
          return;
        }
      }
      await next();
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
            console.log(
              "Running shell command:",
              shellCommand.cmd,
              shellCommand.args,
            );
            const shellResponse = await spaceServer.shellBackend.handle(
              shellCommand,
            );
            response.headers.set("Content-Type", "application/json");
            response.body = JSON.stringify(shellResponse);
            if (shellResponse.code !== 0) {
              console.error("Error running shell command", shellResponse);
            }
            return;
          }
          case "syscall": {
            if (this.syncOnly) {
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
