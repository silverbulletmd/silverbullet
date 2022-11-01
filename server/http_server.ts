import { Application, path, Router } from "./deps.ts";
import { Manifest, SilverBulletHooks } from "../common/manifest.ts";
import { loadMarkdownExtensions } from "../common/markdown_ext.ts";
import buildMarkdown from "../common/parser.ts";
import { DiskSpacePrimitives } from "../common/spaces/disk_space_primitives.ts";
import { EventedSpacePrimitives } from "../common/spaces/evented_space_primitives.ts";
import { Space } from "../common/spaces/space.ts";
import { SpacePrimitives } from "../common/spaces/space_primitives.ts";
import { markdownSyscalls } from "../common/syscalls/markdown.ts";
import { parseYamlSettings } from "../common/util.ts";
import { createSandbox } from "../plugos/environments/deno_sandbox.ts";
import { EndpointHook } from "../plugos/hooks/endpoint.ts";
import { EventHook } from "../plugos/hooks/event.ts";
import { DenoCronHook } from "../plugos/hooks/cron.deno.ts";
import { esbuildSyscalls } from "../plugos/syscalls/esbuild.ts";
import { eventSyscalls } from "../plugos/syscalls/event.ts";
import fileSystemSyscalls from "../plugos/syscalls/fs.deno.ts";
import {
  ensureFTSTable,
  fullTextSearchSyscalls,
} from "../plugos/syscalls/fulltext.sqlite.ts";
import sandboxSyscalls from "../plugos/syscalls/sandbox.ts";
import shellSyscalls from "../plugos/syscalls/shell.node.ts";
import {
  ensureTable as ensureStoreTable,
  storeSyscalls,
} from "../plugos/syscalls/store.deno.ts";
import { System } from "../plugos/system.ts";
import { PageNamespaceHook } from "./hooks/page_namespace.ts";
import { PlugSpacePrimitives } from "./hooks/plug_space_primitives.ts";
import {
  ensureTable as ensureIndexTable,
  pageIndexSyscalls,
} from "./syscalls/index.ts";
import spaceSyscalls from "./syscalls/space.ts";
import { systemSyscalls } from "./syscalls/system.ts";
import { AssetBundlePlugSpacePrimitives } from "../common/spaces/asset_bundle_space_primitives.ts";
import assetSyscalls from "../plugos/syscalls/asset.ts";
import { AssetBundle } from "../plugos/asset_bundle/bundle.ts";
import { AsyncSQLite } from "../plugos/sqlite/async_sqlite.ts";

export type ServerOptions = {
  port: number;
  pagesPath: string;
  assetBundle: AssetBundle;
  password?: string;
};

const indexRequiredKey = "$spaceIndexed";
const staticLastModified = new Date().toUTCString();

export class HttpServer {
  app: Application;
  system: System<SilverBulletHooks>;
  private space: Space;
  private eventHook: EventHook;
  private db: AsyncSQLite;
  private port: number;
  password?: string;
  settings: { [key: string]: any } = {};
  spacePrimitives: SpacePrimitives;
  abortController?: AbortController;
  globalModules: Manifest;
  assetBundle: AssetBundle;

  constructor(options: ServerOptions) {
    this.port = options.port;
    this.app = new Application(); //{ serverConstructor: FlashServer });
    this.assetBundle = options.assetBundle;
    this.password = options.password;

    this.globalModules = JSON.parse(
      this.assetBundle.readTextFileSync(`web/global.plug.json`),
    );

    // Set up the PlugOS System
    this.system = new System<SilverBulletHooks>("server");

    // Instantiate the event bus hook
    this.eventHook = new EventHook();
    this.system.addHook(this.eventHook);

    // And the page namespace hook
    const namespaceHook = new PageNamespaceHook();
    this.system.addHook(namespaceHook);

    // The space
    try {
      this.spacePrimitives = new AssetBundlePlugSpacePrimitives(
        new EventedSpacePrimitives(
          new PlugSpacePrimitives(
            new DiskSpacePrimitives(options.pagesPath),
            namespaceHook,
          ),
          this.eventHook,
        ),
        this.assetBundle,
      );
      this.space = new Space(this.spacePrimitives);
    } catch (e: any) {
      if (e instanceof Deno.errors.NotFound) {
        console.error("Pages folder", options.pagesPath, "not found");
      } else {
        console.error(e.message);
      }
      Deno.exit(1);
    }

    // The database used for persistence (SQLite)
    this.db = new AsyncSQLite(path.join(options.pagesPath, "data.db"));
    this.db.init().catch((e) => {
      console.error("Error initializing database", e);
    });

    // The cron hook
    this.system.addHook(new DenoCronHook());

    // Register syscalls available on the server side
    this.system.registerSyscalls(
      [],
      pageIndexSyscalls(this.db),
      storeSyscalls(this.db, "store"),
      fullTextSearchSyscalls(this.db, "fts"),
      spaceSyscalls(this.space),
      eventSyscalls(this.eventHook),
      markdownSyscalls(buildMarkdown([])),
      esbuildSyscalls([this.globalModules]),
      systemSyscalls(this, this.system),
      sandboxSyscalls(this.system),
      assetSyscalls(this.system),
      // jwtSyscalls(),
    );
    // Danger zone
    this.system.registerSyscalls(["shell"], shellSyscalls(options.pagesPath));
    this.system.registerSyscalls(["fs"], fileSystemSyscalls("/"));

    // Register the HTTP endpoint hook (with "/_/<plug-name>"" prefix, hardcoded for now)
    this.system.addHook(new EndpointHook(this.app, "/_"));

    this.system.on({
      sandboxInitialized: async (sandbox) => {
        for (
          const [modName, code] of Object.entries(
            this.globalModules.dependencies!,
          )
        ) {
          await sandbox.loadDependency(modName, code as string);
        }
      },
    });

    // Second, for loading plug JSON files with absolute or relative (from CWD) paths
    this.eventHook.addLocalListener(
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
      this.space.updatePageList().catch(console.error);
    }, 5000);
  }

  rebuildMdExtensions() {
    this.system.registerSyscalls(
      [],
      markdownSyscalls(buildMarkdown(loadMarkdownExtensions(this.system))),
    );
  }

  async reloadPlugs() {
    await this.space.updatePageList();

    const allPlugs = await this.space.listPlugs();

    console.log("Loading plugs", allPlugs);
    await Promise.all((await this.space.listPlugs()).map(async (plugName) => {
      const { data } = await this.space.readAttachment(plugName, "string");
      await this.system.load(JSON.parse(data as string), createSandbox);
    }));
    this.rebuildMdExtensions();

    const corePlug = this.system.loadedPlugs.get("core");
    if (!corePlug) {
      console.error("Something went very wrong, 'core' plug not found");
      return;
    }

    // Do we need to reindex this space?
    if (
      !(await this.system.localSyscall("core", "store.get", [indexRequiredKey]))
    ) {
      console.log("Now reindexing space...");
      await corePlug.invoke("reindexSpace", []);
      await this.system.localSyscall("core", "store.set", [
        indexRequiredKey,
        true,
      ]);
    }
  }

  async start() {
    await ensureIndexTable(this.db);
    await ensureStoreTable(this.db, "store");
    await ensureFTSTable(this.db, "fts");
    await this.ensureAndLoadSettings();

    // Load plugs
    this.reloadPlugs().catch(console.error);

    // Serve static files (javascript, css, html)
    this.app.use(async ({ request, response }, next) => {
      if (request.url.pathname === "/") {
        if (request.headers.get("If-Modified-Since") === staticLastModified) {
          response.status = 304;
          return;
        }
        response.headers.set("Content-type", "text/html");
        response.body = this.assetBundle.readTextFileSync(
          "web/index.html",
        );
        response.headers.set("Last-Modified", staticLastModified);
        return;
      }
      try {
        const assetName = `web${request.url.pathname}`;
        if (
          this.assetBundle.has(assetName) &&
          request.headers.get("If-Modified-Since") === staticLastModified
        ) {
          response.status = 304;
          return;
        }
        response.status = 200;
        response.headers.set(
          "Content-type",
          this.assetBundle.getMimeType(assetName),
        );
        const data = this.assetBundle.readFileSync(
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

    // Pages API
    const fsRouter = this.buildFsRouter(this.spacePrimitives);
    this.app.use(fsRouter.routes());
    this.app.use(fsRouter.allowedMethods());

    // Plug API
    const plugRouter = this.buildPlugRouter();
    this.app.use(plugRouter.routes());
    this.app.use(plugRouter.allowedMethods());

    // Fallback, serve index.html
    this.app.use((ctx) => {
      ctx.response.headers.set("Content-type", "text/html");
      ctx.response.body = this.assetBundle.readTextFileSync(
        "web/index.html",
      );
    });

    this.abortController = new AbortController();
    this.app.listen({ port: this.port, signal: this.abortController.signal })
      .catch(console.error);
    console.log(
      `Silver Bullet is now running: http://localhost:${this.port}`,
    );
    console.log("--------------");
  }

  private addPasswordAuth(r: Router) {
    if (this.password) {
      r.use(async ({ request, response }, next) => {
        if (
          request.headers.get("Authorization") === `Bearer ${this.password}`
        ) {
          await next();
        } else {
          response.status = 401;
          response.body = "Unauthorized";
        }
      });
    }
  }

  private buildFsRouter(spacePrimitives: SpacePrimitives): Router {
    const fsRouter = new Router();
    this.addPasswordAuth(fsRouter);
    // File list
    fsRouter.get("/", async ({ response }) => {
      const list = await spacePrimitives.fetchFileList();
      // console.log("List", list);
      response.headers.set("Content-type", "application/json");
      response.body = JSON.stringify(list);
    });

    fsRouter
      .get("\/(.+)", async ({ params, response, request }) => {
        const name = params[0];
        console.log("Loading file", name);
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
    this.addPasswordAuth(plugRouter);

    plugRouter.post(
      "/:plug/syscall/:name",
      async (ctx) => {
        const name = ctx.params.name;
        const plugName = ctx.params.plug;
        const args = await ctx.request.body().value;
        console.log("Got args", args, "for", name, "in", plugName);
        const plug = this.system.loadedPlugs.get(plugName);
        if (!plug) {
          ctx.response.status = 404;
          ctx.response.body = `Plug ${plugName} not found`;
          return;
        }
        try {
          const result = await this.system.syscallWithContext(
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
        const plug = this.system.loadedPlugs.get(plugName);
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

  async ensureAndLoadSettings() {
    try {
      await this.space.getPageMeta("SETTINGS");
    } catch {
      await this.space.writePage(
        "SETTINGS",
        this.assetBundle.readTextFileSync("SETTINGS_template.md"),
        true,
      );
    }

    const { text: settingsText } = await this.space.readPage("SETTINGS");
    this.settings = parseYamlSettings(settingsText);
    if (!this.settings.indexPage) {
      this.settings.indexPage = "index";
    }

    try {
      await this.space.getPageMeta(this.settings.indexPage);
    } catch {
      await this.space.writePage(
        this.settings.indexPage,
        `Welcome to your new space!`,
      );
    }
  }

  async stop() {
    if (this.abortController) {
      console.log("Stopping");
      await this.system.unloadAll();
      console.log("Stopped plugs");
      this.abortController.abort();
      console.log("stopped server");
    }
  }
}
