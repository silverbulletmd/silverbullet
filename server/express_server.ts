import { Application, mime, path, Router, SQLite } from "./deps.ts";
import {
  assetReadFileSync,
  assetReadTextFileSync,
} from "../common/asset_bundle.ts";
import { Manifest, SilverBulletHooks } from "../common/manifest.ts";
import { loadMarkdownExtensions } from "../common/markdown_ext.ts";
import buildMarkdown from "../common/parser.ts";
import { plugPrefix } from "../common/spaces/constants.ts";
import { DiskSpacePrimitives } from "../common/spaces/disk_space_primitives.ts";
import { EventedSpacePrimitives } from "../common/spaces/evented_space_primitives.ts";
import { Space } from "../common/spaces/space.ts";
import { SpacePrimitives } from "../common/spaces/space_primitives.ts";
import { markdownSyscalls } from "../common/syscalls/markdown.ts";
import { parseYamlSettings } from "../common/util.ts";
import { createSandbox } from "../plugos/environments/deno_sandbox.ts";
import { EndpointHook } from "../plugos/hooks/endpoint.ts";
import { EventHook } from "../plugos/hooks/event.ts";
import { NodeCronHook } from "../plugos/hooks/node_cron.ts";
import { esbuildSyscalls } from "../plugos/syscalls/esbuild.ts";
import { eventSyscalls } from "../plugos/syscalls/event.ts";
import fileSystemSyscalls from "../plugos/syscalls/fs.deno.ts";
import { fullTextSearchSyscalls } from "../plugos/syscalls/fulltext.knex_sqlite.ts";
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
import { safeRun } from "./util.ts";

// import { jwtSyscalls } from "../plugos/syscalls/jwt.ts";
// import settingsTemplate from "bundle-text:./SETTINGS_template.md";
const safeFilename = /^[a-zA-Z0-9_\-\.]+$/;

export type ServerOptions = {
  port: number;
  pagesPath: string;
  assetBundle: Record<string, string>;
  builtinPlugUrl: URL;
  password?: string;
};

const storeVersionKey = "$silverBulletVersion";
const indexRequiredKey = "$spaceIndexed";

export class ExpressServer {
  app: Application;
  system: System<SilverBulletHooks>;
  private space: Space;
  private eventHook: EventHook;
  private db: SQLite;
  private port: number;
  builtinPlugUrl: URL;
  password?: string;
  settings: { [key: string]: any } = {};
  spacePrimitives: SpacePrimitives;
  abortController?: AbortController;
  globalModules: Manifest;
  assetBundle: Record<string, string>;

  constructor(options: ServerOptions) {
    this.port = options.port;
    this.app = new Application();
    this.builtinPlugUrl = options.builtinPlugUrl;
    this.assetBundle = options.assetBundle;
    this.password = options.password;

    this.globalModules = JSON.parse(
      assetReadTextFileSync(this.assetBundle, `global.plug.json`),
    );

    // Set up the PlugOS System
    this.system = new System<SilverBulletHooks>("server");

    // Instantiate the event bus hook
    this.eventHook = new EventHook();
    this.system.addHook(this.eventHook);

    // And the page namespace hook
    let namespaceHook = new PageNamespaceHook();
    this.system.addHook(namespaceHook);

    // The space
    this.spacePrimitives = new EventedSpacePrimitives(
      new PlugSpacePrimitives(
        new DiskSpacePrimitives(options.pagesPath),
        namespaceHook,
      ),
      this.eventHook,
    );
    this.space = new Space(this.spacePrimitives);

    // The database used for persistence (SQLite)
    this.db = new SQLite(path.join(options.pagesPath, "data.db"));

    // The cron hook
    this.system.addHook(new NodeCronHook());

    // Register syscalls available on the server side
    this.system.registerSyscalls(
      [],
      pageIndexSyscalls(this.db),
      storeSyscalls(this.db, "store"),
      fullTextSearchSyscalls(this.db, "fts"),
      spaceSyscalls(this.space),
      eventSyscalls(this.eventHook),
      markdownSyscalls(buildMarkdown([])),
      esbuildSyscalls(),
      systemSyscalls(this),
      sandboxSyscalls(this.system),
      // jwtSyscalls(),
    );
    // Danger zone
    this.system.registerSyscalls(["shell"], shellSyscalls(options.pagesPath));
    this.system.registerSyscalls(["fs"], fileSystemSyscalls("/"));

    // Register the HTTP endpoint hook (with "/_/<plug-name>"" prefix, hardcoded for now)
    this.system.addHook(new EndpointHook(this.app, "/_"));

    this.system.on({
      plugLoaded: (plug) => {
        // Automatically inject some modules into each plug
        safeRun(async () => {
          for (
            let [modName, code] of Object.entries(
              this.globalModules.dependencies!,
            )
          ) {
            await plug.sandbox.loadDependency(modName, code as string);
          }
        });
      },
    });

    // Hook into some "get-plug:" to allow loading plugs from disk (security of this TBD)
    // First, for builtins (loaded from the packages/plugs/ folder)
    this.eventHook.addLocalListener(
      "get-plug:builtin",
      async (plugName: string): Promise<Manifest> => {
        if (!safeFilename.test(plugName)) {
          throw new Error(`Invalid plug name: ${plugName}`);
        }
        try {
          console.log(
            "Fetching",
            new URL(`${plugName}.plug.json`, this.builtinPlugUrl).toString(),
          );
          return await (await fetch(
            new URL(`${plugName}.plug.json`, this.builtinPlugUrl),
          )).json();
        } catch (e: any) {
          console.error("FEtching builtin", e);
          throw new Error(`No such builtin: ${plugName}`);
        }
      },
    );

    // Second, for loading plug JSON files with absolute or relative (from CWD) paths
    this.eventHook.addLocalListener(
      "get-plug:file",
      async (plugPath: string): Promise<Manifest> => {
        let resolvedPath = path.resolve(plugPath);
        if (!resolvedPath.startsWith(Deno.cwd())) {
          throw new Error(
            `Plugin path outside working directory, this is disallowed: ${resolvedPath}`,
          );
        }
        try {
          let manifestJson = await Deno.readTextFile(resolvedPath);
          return JSON.parse(manifestJson);
        } catch (e) {
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

  // In case of a new space with no `PLUGS` file, generate a default one based on all built-in plugs
  private async bootstrapBuiltinPlugs() {
    let allPlugFiles = await Deno.readDir(this.builtinPlugDir);
    let pluginNames = [];
    for await (let file of allPlugFiles) {
      if (file.name.endsWith(".plug.json")) {
        let manifestJson = await Deno.readTextFile(
          path.join(this.builtinPlugDir, file.name),
        );
        let manifest: Manifest = JSON.parse(manifestJson);
        pluginNames.push(manifest.name);
        await this.spacePrimitives.writeFile(
          `${plugPrefix}${file.name}`,
          "string",
          manifestJson,
        );
      }
    }
    try {
      await this.space.getPageMeta("PLUGS");
      console.log("PLUGS file already exists, won't override it.");
      return;
    } catch {
      console.log("Writing fresh PLUGS file.");
      await this.space.writePage(
        "PLUGS",
        "This file lists all plugs that SilverBullet will load. Run the `Plugs: Update` command to update and reload this list of plugs.\n\n```yaml\n- " +
          pluginNames.map((name) => `builtin:${name}`).join("\n- ") +
          "\n```",
      );
    }
  }

  async reloadPlugs() {
    // Version check
    let lastRunningVersion = await this.system.localSyscall(
      "core",
      "store.get",
      [storeVersionKey],
    );
    let upgrading = false;
    // if (lastRunningVersion !== version) {
    //   upgrading = true;
    //   console.log("Version change detected!");
    //   console.log("Going to re-bootstrap with the builtin set of plugs...");
    //   console.log("First removing existing plug files...");
    //   const existingPlugFiles = (
    //     await this.spacePrimitives.fetchFileList()
    //   ).filter((meta) => meta.name.startsWith(plugPrefix));
    //   for (let plugFile of existingPlugFiles) {
    //     await this.spacePrimitives.deleteFile(plugFile.name);
    //   }
    //   console.log("Now writing the default set of plugs...");
    //   await this.bootstrapBuiltinPlugs();
    //   await this.system.localSyscall("core", "store.set", [
    //     storeVersionKey,
    //     version,
    //   ]);
    //   await this.system.localSyscall("core", "store.set", [
    //     "$spaceIndexed",
    //     false,
    //   ]);
    // }

    await this.space.updatePageList();

    let allPlugs = await this.space.listPlugs();

    // Sanity check: are there any plugs at all? If not, let's put back the core set
    if (allPlugs.length === 0) {
      await this.bootstrapBuiltinPlugs();
      allPlugs = await this.space.listPlugs();
    }
    await this.system.unloadAll();

    console.log("Loading plugs", allPlugs);
    for (let plugName of allPlugs) {
      let { data } = await this.space.readAttachment(plugName, "string");
      await this.system.load(JSON.parse(data as string), createSandbox);
    }
    this.rebuildMdExtensions();

    let corePlug = this.system.loadedPlugs.get("core");
    if (!corePlug) {
      console.error("Something went very wrong, 'core' plug not found");
      return;
    }

    // If we're upgrading, update plugs from PLUGS file
    // This will automatically reinvoke an plugReload() call
    if (upgrading) {
      console.log("Now updating plugs");
      await corePlug.invoke("updatePlugs", []);
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
    const passwordMiddleware: (req: any, res: any, next: any) => void = this
        .password
      ? (req, res, next) => {
        if (req.headers.authorization === `Bearer ${this.password}`) {
          next();
        } else {
          res.status(401).send("Unauthorized");
        }
      }
      : (req, res, next) => {
        next();
      };

    await ensureIndexTable(this.db);
    await ensureStoreTable(this.db, "store");
    // await ensureFTSTable(this.db, "fts");
    await this.ensureAndLoadSettings();

    // Load plugs
    this.reloadPlugs().catch(console.error);

    // Serve static files (javascript, css, html)
    this.app.use(async (ctx, next) => {
      if (ctx.request.url.pathname === "/") {
        ctx.response.headers.set("Content-type", "text/html");
        ctx.response.body = assetReadTextFileSync(
          this.assetBundle,
          "index.html",
        );
        return;
      }
      try {
        ctx.response.body = assetReadFileSync(
          this.assetBundle,
          `${ctx.request.url.pathname.substring(1)}`,
        );
        ctx.response.headers.set(
          "Content-type",
          mime.getType(ctx.request.url.pathname)!,
        );
      } catch {
        await next();
      }
    });

    // Pages API
    const fsRouter = buildFsRouter(this.spacePrimitives);
    this.app.use(fsRouter.routes());
    this.app.use(fsRouter.allowedMethods());

    // Plug API
    const plugRouter = this.buildPlugRouter();
    this.app.use(plugRouter.routes());
    this.app.use(plugRouter.allowedMethods());

    // Fallback, serve index.html
    this.app.use((ctx) => {
      ctx.response.headers.set("Content-type", "text/html");
      ctx.response.body = assetReadTextFileSync(
        this.assetBundle,
        "index.html",
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

  private buildPlugRouter(): Router {
    let plugRouter = new Router();

    plugRouter.post(
      "/:plug/syscall/:name",
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
          const result = await this.system.syscallWithContext(
            { plug },
            name,
            args,
          );
          ctx.response.headers.set("Content-Type", "application/json");
          ctx.response.body = JSON.stringify(result);
        } catch (e: any) {
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
    } catch (e) {
      await this.space.writePage(
        "SETTINGS",
        await Deno.readTextFile(
          new URL("SETTINGS_template.md", import.meta.url).pathname,
        ),
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
    } catch (e) {
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

function buildFsRouter(spacePrimitives: SpacePrimitives): Router {
  const fsRouter = new Router();

  // File list
  fsRouter.get("/", async ({ response }) => {
    const list = await spacePrimitives.fetchFileList();
    // console.log("List", list);
    response.headers.set("Content-type", "application/json");
    response.body = JSON.stringify(list);
  });

  fsRouter
    .get("\/(.+)", async ({ params, request, response }) => {
      let name = params[0];
      console.log("Loading file", name);
      try {
        let attachmentData = await spacePrimitives.readFile(
          name,
          "arraybuffer",
        );
        response.status = 200;
        response.headers.set(
          "Last-Modified",
          "" + attachmentData.meta.lastModified,
        );
        response.headers.set("X-Permission", attachmentData.meta.perm);
        response.headers.set("Content-Type", attachmentData.meta.contentType);
        response.body = attachmentData.data as ArrayBuffer;
      } catch {
        // console.error("Error in main router", e);
        response.status = 404;
        response.body = "";
      }
    })
    .put("\/(.+)", async ({ request, response, params }) => {
      let name = params[0];
      console.log("Saving file", name);

      try {
        let meta = await spacePrimitives.writeFile(
          name,
          "arraybuffer",
          await request.body().value,
          false,
        );
        response.status = 200;
        response.headers.set("Last-Modified", "" + meta.lastModified);
        response.headers.set("Content-Type", meta.contentType);
        response.headers.set("Content-Length", "" + meta.size);
        response.headers.set("X-Permission", meta.perm);
        response.body = "OK";
      } catch (err) {
        response.status = 500;
        response.body = "Write failed";
        console.error("Pipeline failed", err);
      }
    })
    .options("\/(.+)", async ({ request, response, params }, next) => {
      let name = params[0];
      try {
        const meta = await spacePrimitives.getFileMeta(name);
        response.status = 200;
        response.headers.set("Last-Modified", "" + meta.lastModified);
        response.headers.set("Content-Type", meta.contentType);
        response.headers.set("Content-Length", "" + meta.size);
        response.headers.set("X-Permission", meta.perm);
      } catch {
        next();
      }
    })
    .delete("\/(.+)", async ({ request, response, params }) => {
      let name = params[0];
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
