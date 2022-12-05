import { Application, path, Router } from "./deps.ts";
import { Manifest } from "../common/manifest.ts";
import { SpacePrimitives } from "../common/spaces/space_primitives.ts";
import { EndpointHook } from "../plugos/hooks/endpoint.ts";
import { AssetBundle } from "../plugos/asset_bundle/bundle.ts";
import { SpaceSystem } from "./space_system.ts";
import { parseYamlSettings } from "../common/util.ts";

export type ServerOptions = {
  port: number;
  pagesPath: string;
  dbPath: string;
  assetBundle: AssetBundle;
  user?: string;
  pass?: string;
};

const staticLastModified = new Date().toUTCString();

export class HttpServer {
  app: Application;
  systemBoot: SpaceSystem;
  private port: number;
  user?: string;
  settings: { [key: string]: any } = {};
  abortController?: AbortController;

  constructor(options: ServerOptions) {
    this.port = options.port;
    this.app = new Application(); //{ serverConstructor: FlashServer });
    this.user = options.user;
    this.systemBoot = new SpaceSystem(
      options.assetBundle,
      options.pagesPath,
      options.dbPath,
    );

    // Second, for loading plug JSON files with absolute or relative (from CWD) paths
    this.systemBoot.eventHook.addLocalListener(
      "get-plug:file",
      async (plugPath: string): Promise<Manifest> => {
        const resolvedPath = path.resolve(plugPath);
        try {
          const manifestJson = await Deno.readTextFile(resolvedPath);
          return JSON.parse(manifestJson);
        } catch {
          throw new Error(
            `No such file: ${resolvedPath} or could not parse as JSON`,
          );
        }
      },
    );

    // Rescan disk every 5s to detect any out-of-process file changes
    setInterval(() => {
      this.systemBoot.space.updatePageList().catch(console.error);
    }, 5000);

    // Register the HTTP endpoint hook (with "/_/<plug-name>"" prefix, hardcoded for now)
    this.systemBoot.system.addHook(new EndpointHook(this.app, "/_"));
  }

  async start() {
    await this.systemBoot.start();
    await this.systemBoot.ensureSpaceIndex();
    await this.ensureAndLoadSettings();

    // Serve static files (javascript, css, html)
    this.app.use(async ({ request, response }, next) => {
      if (request.url.pathname === "/") {
        if (request.headers.get("If-Modified-Since") === staticLastModified) {
          response.status = 304;
          return;
        }
        response.headers.set("Content-type", "text/html");
        response.body = this.systemBoot.assetBundle.readTextFileSync(
          "web/index.html",
        );
        response.headers.set("Last-Modified", staticLastModified);
        return;
      }
      try {
        const assetName = `web${request.url.pathname}`;
        if (
          this.systemBoot.assetBundle.has(assetName) &&
          request.headers.get("If-Modified-Since") === staticLastModified
        ) {
          response.status = 304;
          return;
        }
        response.status = 200;
        response.headers.set(
          "Content-type",
          this.systemBoot.assetBundle.getMimeType(assetName),
        );
        const data = this.systemBoot.assetBundle.readFileSync(
          assetName,
        );
        response.headers.set("Cache-Control", "no-cache");
        response.headers.set("Content-length", "" + data.length);
        response.headers.set("Last-Modified", staticLastModified);

        if (request.method === "GET") {
          response.body = data;
        }
      } catch {
        await next();
      }
    });

    this.addPasswordAuth(this.app);

    // Pages API
    const fsRouter = this.buildFsRouter(this.systemBoot.spacePrimitives);
    this.app.use(fsRouter.routes());
    this.app.use(fsRouter.allowedMethods());

    // Plug API
    const plugRouter = this.buildPlugRouter();
    this.app.use(plugRouter.routes());
    this.app.use(plugRouter.allowedMethods());

    // Fallback, serve index.html
    this.app.use((ctx) => {
      ctx.response.headers.set("Content-type", "text/html");
      ctx.response.body = this.systemBoot.assetBundle.readTextFileSync(
        "web/index.html",
      );
    });

    this.abortController = new AbortController();
    this.app.listen({ port: this.port, signal: this.abortController.signal })
      .catch((e: any) => {
        console.log("Server listen error:", e.message);
        Deno.exit(1);
      });
    console.log(
      `Silver Bullet is now running: http://localhost:${this.port}`,
    );
  }

  async ensureAndLoadSettings() {
    const space = this.systemBoot.space;
    try {
      await space.getPageMeta("SETTINGS");
    } catch {
      await space.writePage(
        "SETTINGS",
        this.systemBoot.assetBundle.readTextFileSync("SETTINGS_template.md"),
        true,
      );
    }

    const { text: settingsText } = await space.readPage("SETTINGS");
    const settings = parseYamlSettings(settingsText);
    if (!settings.indexPage) {
      settings.indexPage = "index";
    }

    try {
      await space.getPageMeta(settings.indexPage);
    } catch {
      await space.writePage(
        settings.indexPage,
        `Welcome to your new space!`,
      );
    }
  }

  private addPasswordAuth(app: Application) {
    if (this.user) {
      app.use(async ({ request, response }, next) => {
        if (
          request.headers.get("Authorization") ===
            `Basic ${btoa(this.user!)}`
        ) {
          await next();
        } else {
          response.status = 401;
          response.headers.set(
            "WWW-Authenticate",
            `Basic realm="Please enter your username and password"`,
          );
          response.body = "Unauthorized";
        }
      });
    }
  }

  private buildFsRouter(spacePrimitives: SpacePrimitives): Router {
    const fsRouter = new Router();
    // File list
    fsRouter.get("/", async ({ response }) => {
      response.headers.set("Content-type", "application/json");
      response.body = JSON.stringify(await spacePrimitives.fetchFileList());
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

        try {
          const meta = await spacePrimitives.writeFile(
            name,
            "arraybuffer",
            await request.body().value,
            false,
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

  private buildPlugRouter(): Router {
    const plugRouter = new Router();
    // this.addPasswordAuth(plugRouter);
    const system = this.systemBoot.system;

    plugRouter.post(
      "/:plug/syscall/:name",
      async (ctx) => {
        const name = ctx.params.name;
        const plugName = ctx.params.plug;
        const args = await ctx.request.body().value;
        const plug = system.loadedPlugs.get(plugName);
        if (!plug) {
          ctx.response.status = 404;
          ctx.response.body = `Plug ${plugName} not found`;
          return;
        }
        try {
          const result = await system.syscallWithContext(
            { plug },
            name,
            args,
          );
          ctx.response.headers.set("Content-Type", "application/json");
          ctx.response.body = JSON.stringify(result);
        } catch (e: any) {
          console.log("Error", e);
          ctx.response.status = 500;
          ctx.response.body = e.message;
          return;
        }
      },
    );

    plugRouter.post(
      "/:plug/function/:name",
      async (ctx) => {
        const name = ctx.params.name;
        const plugName = ctx.params.plug;
        const args = await ctx.request.body().value;
        const plug = system.loadedPlugs.get(plugName);
        if (!plug) {
          ctx.response.status = 404;
          ctx.response.body = `Plug ${plugName} not found`;
          return;
        }
        try {
          const result = await plug.invoke(name, args);
          ctx.response.headers.set("Content-Type", "application/json");
          ctx.response.body = JSON.stringify(result);
        } catch (e: any) {
          ctx.response.status = 500;
          // console.log("Error invoking function", e);
          ctx.response.body = e.message;
        }
      },
    );

    return new Router().use("/plug", plugRouter.routes());
  }

  async stop() {
    const system = this.systemBoot.system;
    if (this.abortController) {
      console.log("Stopping");
      await system.unloadAll();
      console.log("Stopped plugs");
      this.abortController.abort();
      console.log("stopped server");
    }
  }
}
