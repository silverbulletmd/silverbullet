import { Application, Context, Next, oakCors, Router } from "./deps.ts";
import { SpacePrimitives } from "../common/spaces/space_primitives.ts";
import { AssetBundle } from "../plugos/asset_bundle/bundle.ts";
import { ensureSettingsAndIndex } from "../common/util.ts";
import { performLocalFetch } from "../common/proxy_fetch.ts";
import { BuiltinSettings } from "../web/types.ts";
import { gitIgnoreCompiler } from "./deps.ts";
import { FilteredSpacePrimitives } from "../common/spaces/filtered_space_primitives.ts";
import { Authenticator } from "./auth.ts";
import { FileMeta } from "../common/types.ts";

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
  }

  // Replaces some template variables in index.html in a rather ad-hoc manner, but YOLO
  renderIndexHtml() {
    return this.clientAssetBundle.readTextFileSync(".client/index.html")
      .replaceAll(
        "{{SPACE_PATH}}",
        this.options.pagesPath.replaceAll("\\", "\\\\"),
      );
  }

  async start() {
    await this.reloadSettings();

    // Serve static files (javascript, css, html)
    this.app.use(this.serveStatic.bind(this));

    await this.addPasswordAuth(this.app);
    const fsRouter = this.addFsRoutes(this.spacePrimitives);
    this.app.use(fsRouter.routes());
    this.app.use(fsRouter.allowedMethods());

    // Fallback, serve the UI index.html
    this.app.use(({ response }) => {
      response.headers.set("Content-type", "text/html");
      response.body = this.renderIndexHtml();
    });

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

  serveStatic(
    { request, response }: Context<Record<string, any>, Record<string, any>>,
    next: Next,
  ) {
    if (
      request.url.pathname === "/"
    ) {
      // Serve the UI (index.html)
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
      return next();
    }
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

    // Middleware handling the /.auth page and flow
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
      // Users defined, so enabling auth
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

  private addFsRoutes(spacePrimitives: SpacePrimitives): Router {
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
        if (request.headers.get("Accept") === "application/json") {
          // Only handle direct requests for a JSON representation of the file list
          response.headers.set("Content-type", "application/json");
          response.headers.set("X-Space-Path", this.options.pagesPath);
          const files = await spacePrimitives.fetchFileList();
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
            console.log("Running shell command:", body.cmd, body.args);
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
            if (output.code !== 0) {
              console.error("Error running shell command", stdout, stderr);
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

    const filePathRegex = "\/(.+\\.[a-zA-Z]+)";

    fsRouter
      .get(
        filePathRegex,
        // corsMiddleware,
        async ({ params, response, request }) => {
          const name = params[0];
          console.log("Requested file", name);
          if (name.startsWith(".")) {
            // Don't expose hidden files
            response.status = 404;
            response.body = "Not exposed";
            return;
          }
          try {
            const fileData = await spacePrimitives.readFile(
              name,
            );
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
          } catch {
            // console.error("Error GETting of file", name, e);
            response.status = 404;
            response.body = "Not found";
          }
        },
      )
      .put(
        filePathRegex,
        // corsMiddleware,
        async ({ request, response, params }) => {
          const name = params[0];
          console.log("Saving file", name);
          if (name.startsWith(".")) {
            // Don't expose hidden files
            response.status = 403;
            return;
          }

          const body = await request.body({ type: "bytes" }).value;

          try {
            const meta = await spacePrimitives.writeFile(
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
      .delete(filePathRegex, async ({ response, params }) => {
        const name = params[0];
        console.log("Deleting file", name);
        if (name.startsWith(".")) {
          // Don't expose hidden files
          response.status = 403;
          return;
        }
        try {
          await spacePrimitives.deleteFile(name);
          response.status = 200;
          response.body = "OK";
        } catch (e: any) {
          console.error("Error deleting attachment", e);
          response.status = 500;
          response.body = e.message;
        }
      })
      .options(filePathRegex, corsMiddleware);
    return fsRouter;
  }

  private fileMetaToHeaders(headers: Headers, fileMeta: FileMeta) {
    headers.set("Content-Type", fileMeta.contentType);
    headers.set(
      "X-Last-Modified",
      "" + fileMeta.lastModified,
    );
    headers.set("Cache-Control", "no-cache");
    headers.set("X-Permission", fileMeta.perm);
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
