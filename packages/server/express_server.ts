import express, { Express } from "express";
import { Manifest, SilverBulletHooks } from "@silverbulletmd/common/manifest";
import { EndpointHook } from "@plugos/plugos/hooks/endpoint";
import { readdir, readFile, rm } from "fs/promises";
import { System } from "@plugos/plugos/system";
import { DiskSpacePrimitives } from "@silverbulletmd/common/spaces/disk_space_primitives";
import path from "path";
import bodyParser from "body-parser";
import { EventHook } from "@plugos/plugos/hooks/event";
import spaceSyscalls from "./syscalls/space";
import { eventSyscalls } from "@plugos/plugos/syscalls/event";
import { ensureTable as ensureIndexTable, pageIndexSyscalls } from "./syscalls";
import knex, { Knex } from "knex";
import shellSyscalls from "@plugos/plugos/syscalls/shell.node";
import { NodeCronHook } from "@plugos/plugos/hooks/node_cron";
import { markdownSyscalls } from "@silverbulletmd/common/syscalls/markdown";
import { EventedSpacePrimitives } from "@silverbulletmd/common/spaces/evented_space_primitives";
import { Space } from "@silverbulletmd/common/spaces/space";
import {
  createSandbox,
  nodeModulesDir,
} from "@plugos/plugos/environments/node_sandbox";
import { jwtSyscalls } from "@plugos/plugos/syscalls/jwt";
import buildMarkdown from "@silverbulletmd/common/parser";
import { loadMarkdownExtensions } from "@silverbulletmd/common/markdown_ext";
import http, { Server } from "http";
import { esbuildSyscalls } from "@plugos/plugos/syscalls/esbuild";
import { systemSyscalls } from "./syscalls/system";
import { plugPrefix } from "@silverbulletmd/common/spaces/constants";

import sandboxSyscalls from "@plugos/plugos/syscalls/sandbox";
// @ts-ignore
import settingsTemplate from "bundle-text:./SETTINGS_template.md";
import { safeRun } from "./util";
import {
  ensureFTSTable,
  fullTextSearchSyscalls,
} from "@plugos/plugos/syscalls/fulltext.knex_sqlite";
import { PlugSpacePrimitives } from "./hooks/plug_space_primitives";
import { PageNamespaceHook } from "./hooks/page_namespace";
import { readFileSync } from "fs";
import fileSystemSyscalls from "@plugos/plugos/syscalls/fs.node";
import {
  ensureTable as ensureStoreTable,
  storeSyscalls,
} from "@plugos/plugos/syscalls/store.knex_node";
import { parseYamlSettings } from "@silverbulletmd/common/util";
import { SpacePrimitives } from "@silverbulletmd/common/spaces/space_primitives";

import { version } from "./package.json";

const globalModules: any = JSON.parse(
  readFileSync(
    nodeModulesDir + "/node_modules/@silverbulletmd/web/dist/global.plug.json",
    "utf-8"
  )
);

const safeFilename = /^[a-zA-Z0-9_\-\.]+$/;

export type ServerOptions = {
  port: number;
  pagesPath: string;
  distDir: string;
  builtinPlugDir: string;
  password?: string;
};

const storeVersionKey = "$silverBulletVersion";
const indexRequiredKey = "$spaceIndexed";

export class ExpressServer {
  app: Express;
  system: System<SilverBulletHooks>;
  private space: Space;
  private distDir: string;
  private eventHook: EventHook;
  private db: Knex<any, unknown[]>;
  private port: number;
  private server?: Server;
  builtinPlugDir: string;
  password?: string;
  settings: { [key: string]: any } = {};
  spacePrimitives: SpacePrimitives;

  constructor(options: ServerOptions) {
    this.port = options.port;
    this.app = express();
    this.builtinPlugDir = options.builtinPlugDir;
    this.distDir = options.distDir;
    this.password = options.password;

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
        namespaceHook
      ),
      this.eventHook
    );
    this.space = new Space(this.spacePrimitives);

    // The database used for persistence (SQLite)
    this.db = knex({
      client: "better-sqlite3",
      connection: {
        filename: path.join(options.pagesPath, "data.db"),
      },
      useNullAsDefault: true,
    });

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
      jwtSyscalls()
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
          for (let [modName, code] of Object.entries(
            globalModules.dependencies
          )) {
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
          let manifestJson = await readFile(
            path.join(this.builtinPlugDir, `${plugName}.plug.json`),
            "utf8"
          );
          return JSON.parse(manifestJson);
        } catch (e) {
          throw new Error(`No such builtin: ${plugName}`);
        }
      }
    );

    // Second, for loading plug JSON files with absolute or relative (from CWD) paths
    this.eventHook.addLocalListener(
      "get-plug:file",
      async (plugPath: string): Promise<Manifest> => {
        let resolvedPath = path.resolve(plugPath);
        if (!resolvedPath.startsWith(process.cwd())) {
          throw new Error(
            `Plugin path outside working directory, this is disallowed: ${resolvedPath}`
          );
        }
        try {
          let manifestJson = await readFile(resolvedPath, "utf8");
          return JSON.parse(manifestJson);
        } catch (e) {
          throw new Error(
            `No such file: ${resolvedPath} or could not parse as JSON`
          );
        }
      }
    );

    // Rescan disk every 5s to detect any out-of-process file changes
    setInterval(() => {
      this.space.updatePageList().catch(console.error);
    }, 5000);
  }

  rebuildMdExtensions() {
    this.system.registerSyscalls(
      [],
      markdownSyscalls(buildMarkdown(loadMarkdownExtensions(this.system)))
    );
  }

  // In case of a new space with no `PLUGS` file, generate a default one based on all built-in plugs
  private async bootstrapBuiltinPlugs() {
    let allPlugFiles = await readdir(this.builtinPlugDir);
    let pluginNames = [];
    for (let file of allPlugFiles) {
      if (file.endsWith(".plug.json")) {
        let manifestJson = await readFile(
          path.join(this.builtinPlugDir, file),
          "utf8"
        );
        let manifest: Manifest = JSON.parse(manifestJson);
        pluginNames.push(manifest.name);
        await this.spacePrimitives.writeFile(
          `${plugPrefix}${file}`,
          "string",
          manifestJson
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
          "\n```"
      );
    }
  }

  async reloadPlugs() {
    // Version check
    let lastRunningVersion = await this.system.localSyscall(
      "core",
      "store.get",
      [storeVersionKey]
    );
    let upgrading = false;
    if (lastRunningVersion !== version) {
      upgrading = true;
      console.log("Version change detected!");
      console.log("Going to re-bootstrap with the builtin set of plugs...");
      console.log("First removing existing plug files...");
      const existingPlugFiles = (
        await this.spacePrimitives.fetchFileList()
      ).filter((meta) => meta.name.startsWith(plugPrefix));
      for (let plugFile of existingPlugFiles) {
        await this.spacePrimitives.deleteFile(plugFile.name);
      }
      console.log("Now writing the default set of plugs...");
      await this.bootstrapBuiltinPlugs();
      await this.system.localSyscall("core", "store.set", [
        storeVersionKey,
        version,
      ]);
      await this.system.localSyscall("core", "store.set", [
        "$spaceIndexed",
        false,
      ]);
    }

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
    await ensureFTSTable(this.db, "fts");
    await this.ensureAndLoadSettings();

    // Load plugs
    this.reloadPlugs().catch(console.error);

    // Serve static files (javascript, css, html)
    this.app.use("/", express.static(this.distDir));

    // Pages API
    this.app.use(
      "/fs",
      passwordMiddleware,
      buildFsRouter(this.spacePrimitives)
    );

    // Plug API
    this.app.use("/plug", passwordMiddleware, this.buildPlugRouter());

    // Fallback, serve index.html
    this.app.get(/^(\/((?!fs\/).)+)$/, async (req, res) => {
      res.sendFile(`${this.distDir}/index.html`, {});
    });

    this.server = http.createServer(this.app);
    this.server.listen(this.port, () => {
      console.log(
        `Silver Bullet is now running: http://localhost:${this.port}`
      );
      console.log("--------------");
    });
  }

  private buildPlugRouter() {
    let plugRouter = express.Router();

    plugRouter.post(
      "/:plug/syscall/:name",
      bodyParser.json(),
      async (req, res) => {
        const name = req.params.name;
        const plugName = req.params.plug;
        const args = req.body as any;
        const plug = this.system.loadedPlugs.get(plugName);
        if (!plug) {
          res.status(404);
          return res.send(`Plug ${plugName} not found`);
        }
        try {
          const result = await this.system.syscallWithContext(
            { plug },
            name,
            args
          );
          res.status(200);
          res.header("Content-Type", "application/json");
          res.send(JSON.stringify(result));
        } catch (e: any) {
          res.status(500);
          return res.send(e.message);
        }
      }
    );

    plugRouter.post(
      "/:plug/function/:name",
      bodyParser.json(),
      async (req, res) => {
        const name = req.params.name;
        const plugName = req.params.plug;
        const args = req.body as any[];
        const plug = this.system.loadedPlugs.get(plugName);
        if (!plug) {
          res.status(404);
          return res.send(`Plug ${plugName} not found`);
        }
        try {
          const result = await plug.invoke(name, args);
          res.status(200);
          res.header("Content-Type", "application/json");
          res.send(JSON.stringify(result));
        } catch (e: any) {
          res.status(500);
          // console.log("Error invoking function", e);
          return res.send(e.message);
        }
      }
    );

    return plugRouter;
  }

  async ensureAndLoadSettings() {
    try {
      await this.space.getPageMeta("SETTINGS");
    } catch (e) {
      await this.space.writePage("SETTINGS", settingsTemplate, true);
    }

    let { text: settingsText } = await this.space.readPage("SETTINGS");
    this.settings = parseYamlSettings(settingsText);
    if (!this.settings.indexPage) {
      this.settings.indexPage = "index";
    }

    try {
      await this.space.getPageMeta(this.settings.indexPage);
    } catch (e) {
      await this.space.writePage(
        this.settings.indexPage,
        `Welcome to your new space!`
      );
    }
  }

  async stop() {
    if (this.server) {
      console.log("Stopping");
      await this.system.unloadAll();
      console.log("Stopped plugs");
      return new Promise<void>((resolve, reject) => {
        this.server!.close((err) => {
          this.server = undefined;
          console.log("stopped server");
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
    }
  }
}

function buildFsRouter(spacePrimitives: SpacePrimitives) {
  let fsRouter = express.Router();

  // File list
  fsRouter.route("/").get(async (req, res, next) => {
    res.json(await spacePrimitives.fetchFileList());
  });

  fsRouter
    .route(/\/(.+)/)
    .get(async (req, res, next) => {
      let name = req.params[0];
      console.log("Loading file", name);
      try {
        let attachmentData = await spacePrimitives.readFile(
          name,
          "arraybuffer"
        );
        res.status(200);
        res.header("Last-Modified", "" + attachmentData.meta.lastModified);
        res.header("X-Permission", attachmentData.meta.perm);
        res.header("Content-Type", attachmentData.meta.contentType);
        res.send(Buffer.from(attachmentData.data as ArrayBuffer));
      } catch (e) {
        next();
      }
    })
    .put(bodyParser.raw({ type: "*/*", limit: "100mb" }), async (req, res) => {
      let name = req.params[0];
      console.log("Saving file", name);

      try {
        let meta = await spacePrimitives.writeFile(
          name,
          "arraybuffer",
          req.body,
          false
        );
        res.status(200);
        res.header("Last-Modified", "" + meta.lastModified);
        res.header("Content-Type", meta.contentType);
        res.header("Content-Length", "" + meta.size);
        res.header("X-Permission", meta.perm);
        res.send("OK");
      } catch (err) {
        res.status(500);
        res.send("Write failed");
        console.error("Pipeline failed", err);
      }
    })
    .options(async (req, res, next) => {
      let name = req.params[0];
      try {
        const meta = await spacePrimitives.getFileMeta(name);
        res.status(200);
        res.header("Last-Modified", "" + meta.lastModified);
        res.header("X-Permission", meta.perm);
        res.header("Content-Length", "" + meta.size);
        res.header("Content-Type", meta.contentType);
        res.send("");
      } catch (e) {
        next();
      }
    })
    .delete(async (req, res) => {
      let name = req.params[0];
      try {
        await spacePrimitives.deleteFile(name);
        res.status(200);
        res.send("OK");
      } catch (e) {
        console.error("Error deleting attachment", e);
        res.status(500);
        res.send("OK");
      }
    });
  return fsRouter;
}
