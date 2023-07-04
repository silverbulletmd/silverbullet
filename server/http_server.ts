import { Application, Router } from "./deps.ts";
import { SpacePrimitives } from "../common/spaces/space_primitives.ts";
import { AssetBundle } from "../plugos/asset_bundle/bundle.ts";
import { base64Decode } from "../plugos/asset_bundle/base64.ts";
import { ensureSettingsAndIndex } from "../common/util.ts";
import { performLocalFetch } from "../common/proxy_fetch.ts";
import { BuiltinSettings } from "../web/types.ts";
import { gitIgnoreCompiler } from "./deps.ts";
import { FilteredSpacePrimitives } from "../common/spaces/filtered_space_primitives.ts";
import { CollabServer } from "./collab.ts";
import { Authenticator } from "./auth.ts";
import { oakCors } from "https://deno.land/x/cors@v1.2.2/mod.ts";

export type ServerOptions = {
  hostname: string;
  port: number;
  pagesPath: string;
  clientAssetBundle: AssetBundle;
  authenticator: Authenticator;
  pass?: string;
  certFile?: string;
  keyFile?: string;
  maxFileSizeMB?: number;
};

export class HttpServer {
  app: Application;
  private hostname: string;
  private port: number;
  abortController?: AbortController;
  clientAssetBundle: AssetBundle;
  settings?: BuiltinSettings;
  spacePrimitives: SpacePrimitives;
  collab: CollabServer;
  authenticator: Authenticator;

  constructor(
    spacePrimitives: SpacePrimitives,
    private options: ServerOptions,
  ) {
    this.hostname = options.hostname;
    this.port = options.port;
    this.app = new Application();
    this.authenticator = options.authenticator;
    this.clientAssetBundle = options.clientAssetBundle;

    let fileFilterFn: (s: string) => boolean = () => true;
    this.spacePrimitives = new FilteredSpacePrimitives(
      spacePrimitives,
      (meta) => {
        // Don't list file exceeding the maximum file size
        if (
          options.maxFileSizeMB &&
          meta.size / (1024 * 1024) > options.maxFileSizeMB
        ) {
          return false;
        }
        return fileFilterFn(meta.name);
      },
      async () => {
        await this.reloadSettings();
        if (typeof this.settings?.spaceIgnore === "string") {
          fileFilterFn = gitIgnoreCompiler(this.settings.spaceIgnore).accepts;
        } else {
          fileFilterFn = () => true;
        }
      },
    );
    this.collab = new CollabServer(this.spacePrimitives);
    this.collab.start();
  }

  // Replaces some template variables in index.html in a rather ad-hoc manner, but YOLO
  renderIndexHtml() {
    return this.clientAssetBundle.readTextFileSync(".client/index.html")
      .replaceAll(
        "{{SPACE_PATH}}",
        this.options.pagesPath.replaceAll("\\", "\\\\"),
      ).replaceAll(
        "{{SYNC_ENDPOINT}}",
        "/.fs",
      );
  }

  async start() {
    await this.reloadSettings();
    // Serve static files (javascript, css, html)
    this.app.use(async ({ request, response }, next) => {
      if (request.url.pathname === "/") {
        // Note: we're explicitly not setting Last-Modified and If-Modified-Since header here because this page is dynamic
        response.headers.set("Content-type", "text/html");
        response.body = this.renderIndexHtml();
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
        await next();
      }
    });

    // Fallback, serve index.html
    this.app.use(({ request, response }, next) => {
      if (
        !request.url.pathname.startsWith("/.fs") &&
        request.url.pathname !== "/.auth" &&
        !request.url.pathname.startsWith("/.ws")
      ) {
        response.headers.set("Content-type", "text/html");
        response.body = this.renderIndexHtml();
      } else {
        return next();
      }
    });

    // Pages API
    const fsRouter = this.buildFsRouter(this.spacePrimitives);
    await this.addPasswordAuth(this.app);
    this.app.use(fsRouter.routes());
    this.app.use(fsRouter.allowedMethods());

    this.collab.route(this.app);

    this.abortController = new AbortController();
    const listenOptions: any = {
      hostname: this.hostname,
      port: this.port,
      signal: this.abortController.signal,
    };
    if (this.options.keyFile) {
      listenOptions.key = Deno.readTextFileSync(this.options.keyFile);
    }
    if (this.options.certFile) {
      listenOptions.cert = Deno.readTextFileSync(this.options.certFile);
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

  async reloadSettings() {
    // TODO: Throttle this?
    this.settings = await ensureSettingsAndIndex(this.spacePrimitives);
  }

  private async addPasswordAuth(app: Application) {
    const excludedPaths = [
      "/manifest.json",
      "/favicon.png",
      "/logo.png",
      "/.auth",
    ];

    app.use(async ({ request, response, cookies }, next) => {
      if (request.url.pathname === "/.auth") {
        if (request.url.search === "?logout") {
          await cookies.delete("auth");
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
          const username = values.get("username")!,
            password = values.get("password")!,
            refer = values.get("refer");
          const hashedPassword = await this.authenticator.authenticate(
            username,
            password,
          );
          if (hashedPassword) {
            await cookies.set("auth", `${username}:${hashedPassword}`, {
              expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7), // in a week
              sameSite: "strict",
            });
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

    if ((await this.authenticator.getAllUsers()).length > 0) {
      app.use(async ({ request, response, cookies }, next) => {
        if (!excludedPaths.includes(request.url.pathname)) {
          const authCookie = await cookies.get("auth");
          if (!authCookie) {
            response.redirect("/.auth");
            return;
          }
          const [username, hashedPassword] = authCookie.split(":");
          if (
            !await this.authenticator.authenticateHashed(
              username,
              hashedPassword,
            )
          ) {
            response.redirect("/.auth");
            return;
          }
        }
        await next();
      });
    }
  }

  private buildFsRouter(spacePrimitives: SpacePrimitives): Router {
    const fsRouter = new Router();
    const corsMiddleware = oakCors({
      allowedHeaders: "*",
      exposedHeaders: "*",
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    });
    // File list
    fsRouter.get("/", corsMiddleware, async ({ response }) => {
      response.headers.set("Content-type", "application/json");
      response.headers.set("X-Space-Path", this.options.pagesPath);
      const files = await spacePrimitives.fetchFileList();
      response.body = JSON.stringify(files);
    });

    // RPC
    fsRouter.post("/", corsMiddleware, async ({ request, response }) => {
      const body = await request.body({ type: "json" }).value;
      try {
        switch (body.operation) {
          case "fetch": {
            const result = await performLocalFetch(body.url, body.options);
            console.log("Proxying fetch request to", body.url);
            response.headers.set("Content-Type", "application/json");
            response.body = JSON.stringify(result);
            return;
          }
          case "shell": {
            // TODO: Have a nicer way to do this
            if (this.options.pagesPath.startsWith("s3://")) {
              response.status = 500;
              response.body = JSON.stringify({
                stdout: "",
                stderr: "Cannot run shell commands with S3 backend",
                code: 500,
              });
              return;
            }
            const p = new Deno.Command(body.cmd, {
              args: body.args,
              cwd: this.options.pagesPath,
              stdout: "piped",
              stderr: "piped",
            });
            const output = await p.output();
            const stdout = new TextDecoder().decode(output.stdout);
            const stderr = new TextDecoder().decode(output.stderr);

            response.headers.set("Content-Type", "application/json");
            response.body = JSON.stringify({
              stdout,
              stderr,
              code: output.code,
            });
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

    fsRouter
      .get("\/(.+)", corsMiddleware, async ({ params, response, request }) => {
        const name = params[0];
        console.log("Loading file", name);
        if (name.startsWith(".")) {
          // Don't expose hidden files
          response.status = 404;
          return;
        }
        try {
          const attachmentData = await spacePrimitives.readFile(
            name,
          );
          const lastModifiedHeader = new Date(attachmentData.meta.lastModified)
            .toUTCString();
          if (request.headers.get("If-Modified-Since") === lastModifiedHeader) {
            response.status = 304;
            return;
          }
          response.status = 200;
          response.headers.set(
            "X-Last-Modified",
            "" + attachmentData.meta.lastModified,
          );
          response.headers.set("Cache-Control", "no-cache");
          response.headers.set("X-Permission", attachmentData.meta.perm);
          response.headers.set(
            "Last-Modified",
            lastModifiedHeader,
          );
          response.headers.set("Content-Type", attachmentData.meta.contentType);
          response.body = attachmentData.data;
        } catch {
          // console.error("Error in main router", e);
          response.status = 404;
          response.body = "";
        }
      })
      .put("\/(.+)", corsMiddleware, async ({ request, response, params }) => {
        const name = params[0];
        console.log("Saving file", name);
        if (name.startsWith(".")) {
          // Don't expose hidden files
          response.status = 403;
          return;
        }

        let body: Uint8Array;
        if (
          request.headers.get("X-Content-Base64")
        ) {
          const content = await request.body({ type: "text" }).value;
          body = base64Decode(content);
        } else {
          body = await request.body({ type: "bytes" }).value;
        }

        try {
          const meta = await spacePrimitives.writeFile(
            name,
            body,
          );
          response.status = 200;
          response.headers.set("Content-Type", meta.contentType);
          response.headers.set("X-Last-Modified", "" + meta.lastModified);
          response.headers.set("X-Content-Length", "" + meta.size);
          response.headers.set("X-Permission", meta.perm);
          response.body = "OK";
        } catch (err) {
          response.status = 500;
          response.body = "Write failed";
          console.error("Pipeline failed", err);
        }
      })
      .options("\/(.+)", async ({ request, response, params }) => {
        const name = params[0];
        // Manually set CORS headers
        response.headers.set("access-control-allow-headers", "*");
        response.headers.set(
          "access-control-allow-methods",
          "GET,POST,PUT,DELETE,OPTIONS",
        );
        response.headers.set("access-control-allow-origin", "*");
        response.headers.set("access-control-expose-headers", "*");
        try {
          const meta = await spacePrimitives.getFileMeta(name);
          response.status = 200;
          response.headers.set("Content-Type", meta.contentType);
          response.headers.set("X-Last-Modified", "" + meta.lastModified);
          response.headers.set("X-Content-Length", "" + meta.size);
          response.headers.set("X-Permission", meta.perm);

          const clientId = request.headers.get("X-Client-Id");
          if (name.endsWith(".md") && clientId) {
            const pageName = name.substring(0, name.length - ".md".length);
            console.log(`Got presence update from ${clientId}: ${pageName}`);
            const { collabId } = this.collab.updatePresence(clientId, pageName);
            if (collabId) {
              response.headers.set("X-Collab-Id", collabId);
            }
          }
        } catch {
          // Have to do this because of CORS
          response.status = 200;
          response.headers.set("X-Status", "404");
          response.body = "Not found";
          // console.error("Options failed", err);
        }
      })
      .delete("\/(.+)", corsMiddleware, async ({ response, params }) => {
        const name = params[0];
        console.log("Deleting file", name);
        try {
          await spacePrimitives.deleteFile(name);
          response.status = 200;
          response.body = "OK";
        } catch (e: any) {
          console.error("Error deleting attachment", e);
          response.status = 200;
          response.body = e.message;
        }
      });
    return new Router().use("/.fs", fsRouter.routes());
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
