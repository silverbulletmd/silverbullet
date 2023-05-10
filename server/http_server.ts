import { Application, Router } from "./deps.ts";
import { SpacePrimitives } from "../common/spaces/space_primitives.ts";
import { AssetBundle } from "../plugos/asset_bundle/bundle.ts";
import { base64Decode } from "../plugos/asset_bundle/base64.ts";
import { AssetBundlePlugSpacePrimitives } from "../common/spaces/asset_bundle_space_primitives.ts";
import { DiskSpacePrimitives } from "../common/spaces/disk_space_primitives.ts";
import { ensureSettingsAndIndex } from "../common/util.ts";

export type ServerOptions = {
  hostname: string;
  port: number;
  pagesPath: string;
  clientAssetBundle: AssetBundle;
  plugAssetBundle: AssetBundle;
  user?: string;
  pass?: string;
};

// const staticLastModified = new Date().toUTCString();

export class HttpServer {
  app: Application;
  private hostname: string;
  private port: number;
  user?: string;
  settings: { [key: string]: any } = {};
  abortController?: AbortController;
  spacePrimitives: SpacePrimitives;
  clientAssetBundle: AssetBundle;

  constructor(private options: ServerOptions) {
    this.hostname = options.hostname;
    this.port = options.port;
    this.app = new Application(); //{ serverConstructor: FlashServer });
    this.user = options.user;
    this.clientAssetBundle = options.clientAssetBundle;
    this.spacePrimitives = new AssetBundlePlugSpacePrimitives(
      new DiskSpacePrimitives(options.pagesPath),
      options.plugAssetBundle,
    );
  }

  renderIndexHtml() {
    return this.clientAssetBundle.readTextFileSync("index.html").replaceAll(
      "{{SPACE_PATH}}",
      this.options.pagesPath,
    );
  }

  async start() {
    this.addPasswordAuth(this.app);

    await ensureSettingsAndIndex(this.spacePrimitives);

    // Serve static files (javascript, css, html)
    this.app.use(async ({ request, response }, next) => {
      if (request.url.pathname === "/") {
        const indexLastModified = utcDateString(
          this.clientAssetBundle.getMtime("index.html"),
        );

        if (request.headers.get("If-Modified-Since") === indexLastModified) {
          response.status = 304;
          return;
        }
        response.headers.set("Content-type", "text/html");
        response.body = this.renderIndexHtml();
        response.headers.set("Last-Modified", indexLastModified);
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

    // Pages API
    const fsRouter = this.buildFsRouter(this.spacePrimitives);
    this.app.use(fsRouter.routes());
    this.app.use(fsRouter.allowedMethods());

    // Fallback, serve index.html
    this.app.use((ctx) => {
      ctx.response.headers.set("Content-type", "text/html");
      ctx.response.body = this.renderIndexHtml();
    });

    this.abortController = new AbortController();
    this.app.listen({
      hostname: this.hostname,
      port: this.port,
      signal: this.abortController.signal,
    })
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

  private addPasswordAuth(app: Application) {
    const excludedPaths = [
      "/manifest.json",
      "/favicon.png",
      "/logo.png",
      "/.auth",
    ];
    if (this.user) {
      const b64User = btoa(this.user);
      app.use(async ({ request, response, cookies }, next) => {
        if (!excludedPaths.includes(request.url.pathname)) {
          const authCookie = await cookies.get("auth");
          if (!authCookie || authCookie !== b64User) {
            response.redirect(`/.auth?refer=${request.url.pathname}`);
            return;
          }
        }
        if (request.url.pathname === "/.auth") {
          if (request.method === "GET") {
            response.headers.set("Content-type", "text/html");
            response.body = this.clientAssetBundle.readTextFileSync(
              "auth.html",
            );
            return;
          } else if (request.method === "POST") {
            const values = await request.body({ type: "form" }).value;
            const username = values.get("username"),
              password = values.get("password"),
              refer = values.get("refer");
            if (this.user === `${username}:${password}`) {
              await cookies.set("auth", b64User, {
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
            response.status = 401;
            response.body = "Unauthorized";
            return;
          }
        } else {
          // Unauthenticated access to excluded paths
          await next();
        }
      });
    }
  }

  private buildFsRouter(spacePrimitives: SpacePrimitives): Router {
    const fsRouter = new Router();
    // File list
    fsRouter.get("/", async ({ response }) => {
      response.headers.set("Content-type", "application/json");
      const files = await spacePrimitives.fetchFileList();
      response.body = JSON.stringify(files);
    });

    fsRouter
      .get("\/(.+)", async ({ params, response, request }) => {
        const name = params[0];
        // console.log("Loading file", name);
        try {
          const attachmentData = await spacePrimitives.readFile(
            name,
            "arraybuffer",
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
          response.body = attachmentData.data as ArrayBuffer;
        } catch {
          // console.error("Error in main router", e);
          response.status = 404;
          response.body = "";
        }
      })
      .put("\/(.+)", async ({ request, response, params }) => {
        const name = params[0];
        console.log("Saving file", name);

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
            "arraybuffer",
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
      .options("\/(.+)", async ({ response, params }) => {
        const name = params[0];
        try {
          const meta = await spacePrimitives.getFileMeta(name);
          response.status = 200;
          response.headers.set("Content-Type", meta.contentType);
          response.headers.set("X-Last-Modified", "" + meta.lastModified);
          response.headers.set("X-Content-Length", "" + meta.size);
          response.headers.set("X-Permission", meta.perm);
        } catch {
          response.status = 404;
          response.body = "File not found";
          // console.error("Options failed", err);
        }
      })
      .delete("\/(.+)", async ({ response, params }) => {
        const name = params[0];
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
    return new Router().use("/fs", fsRouter.routes());
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
