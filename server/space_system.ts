import { SilverBulletHooks } from "../common/manifest.ts";
import { loadMarkdownExtensions } from "../common/markdown_parser/markdown_ext.ts";
import buildMarkdown from "../common/markdown_parser/parser.ts";
import { DiskSpacePrimitives } from "../common/spaces/disk_space_primitives.ts";
import { EventedSpacePrimitives } from "../common/spaces/evented_space_primitives.ts";
import { Space } from "../common/spaces/space.ts";
import { SpacePrimitives } from "../common/spaces/space_primitives.ts";
import { markdownSyscalls } from "../common/syscalls/markdown.ts";
import { createSandbox } from "../plugos/environments/deno_sandbox.ts";
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
import shellSyscalls from "../plugos/syscalls/shell.deno.ts";
import {
  ensureTable as ensureStoreTable,
  storeSyscalls,
} from "../plugos/syscalls/store.sqlite.ts";
import { System } from "../plugos/system.ts";
import { PageNamespaceHook } from "../common/hooks/page_namespace.ts";
import { PlugSpacePrimitives } from "../common/spaces/plug_space_primitives.ts";
import {
  ensureTable as ensureIndexTable,
  pageIndexSyscalls,
} from "./syscalls/index.ts";
import spaceSyscalls from "../common/syscalls/space.ts";
import { systemSyscalls } from "./syscalls/system.ts";
import { AssetBundlePlugSpacePrimitives } from "../common/spaces/asset_bundle_space_primitives.ts";
import assetSyscalls from "../plugos/syscalls/asset.ts";
import { AssetBundle } from "../plugos/asset_bundle/bundle.ts";
import { AsyncSQLite } from "../plugos/sqlite/async_sqlite.ts";
import { FileMetaSpacePrimitives } from "../common/spaces/file_meta_space_primitives.ts";
import { sandboxFetchSyscalls } from "../plugos/syscalls/fetch.ts";
import { syncSyscalls } from "../common/syscalls/sync.ts";
export const indexRequiredKey = "$spaceIndexed";

// A composition of a PlugOS system attached to a Space for server-side use
export class SpaceSystem {
  public system: System<SilverBulletHooks>;
  public space: Space;
  public eventHook: EventHook;
  public spacePrimitives: SpacePrimitives;

  private db: AsyncSQLite;

  constructor(
    readonly assetBundle: AssetBundle,
    pagesPath: string,
    databasePath: string,
  ) {
    const globalModules = JSON.parse(
      assetBundle.readTextFileSync(`web/global.plug.json`),
    );

    // Set up the PlugOS System
    this.system = new System<SilverBulletHooks>("server");

    // Instantiate the event bus hook
    this.eventHook = new EventHook();
    this.system.addHook(this.eventHook);

    // And the page namespace hook
    const namespaceHook = new PageNamespaceHook();
    this.system.addHook(namespaceHook);

    // The database used for persistence (SQLite)
    this.db = new AsyncSQLite(databasePath);
    this.db.init().catch((e) => {
      console.error("Error initializing database", e);
    });

    const indexSyscalls = pageIndexSyscalls(this.db);
    // The space
    try {
      this.spacePrimitives = new FileMetaSpacePrimitives(
        new AssetBundlePlugSpacePrimitives(
          new EventedSpacePrimitives(
            new PlugSpacePrimitives(
              new DiskSpacePrimitives(pagesPath),
              namespaceHook,
              "server",
            ),
            this.eventHook,
          ),
          assetBundle,
        ),
        indexSyscalls,
      );
      this.space = new Space(this.spacePrimitives);
    } catch (e: any) {
      if (e instanceof Deno.errors.NotFound) {
        console.error("Pages folder", pagesPath, "not found");
      } else {
        console.error(e.message);
      }
      Deno.exit(1);
    }

    // The cron hook
    this.system.addHook(new DenoCronHook());

    // Register syscalls available on the server side
    this.system.registerSyscalls(
      [],
      indexSyscalls,
      storeSyscalls(this.db, "store"),
      fullTextSearchSyscalls(this.db, "fts"),
      spaceSyscalls(this.space),
      syncSyscalls(this.spacePrimitives),
      eventSyscalls(this.eventHook),
      markdownSyscalls(buildMarkdown([])),
      esbuildSyscalls([globalModules]),
      systemSyscalls(this.loadPlugsFromSpace.bind(this), this.system),
      sandboxSyscalls(this.system),
      assetSyscalls(this.system),
      sandboxFetchSyscalls(),
    );

    // Danger zone, these syscalls require requesting specific permissions
    this.system.registerSyscalls(["shell"], shellSyscalls(pagesPath));
    this.system.registerSyscalls(["fs"], fileSystemSyscalls("/"));

    this.system.on({
      sandboxInitialized: async (sandbox) => {
        for (
          const [modName, code] of Object.entries(
            globalModules.dependencies!,
          )
        ) {
          await sandbox.loadDependency(modName, code as string);
        }
      },
    });
  }

  // Loads all plugs under "_plug/" in the space
  async loadPlugsFromSpace() {
    await this.space.updatePageList();

    const allPlugs = await this.space.listPlugs();

    console.log("Going to load", allPlugs.length, "plugs...");
    await Promise.all(allPlugs.map(async (plugName) => {
      const { data } = await this.space.readAttachment(plugName, "utf8");
      await this.system.load(JSON.parse(data as string), createSandbox);
    }));

    // Re-register the markdown syscall with new markdown extensions
    this.system.registerSyscalls(
      [],
      markdownSyscalls(buildMarkdown(loadMarkdownExtensions(this.system))),
    );
  }

  // Checks if the space has been indexed, and if not, does so
  async ensureSpaceIndex(forceReindex = false) {
    const corePlug = this.system.loadedPlugs.get("core");
    if (!corePlug) {
      console.error("Something went very wrong, 'core' plug not found");
      return;
    }

    // Do we need to reindex this space?
    if (
      forceReindex ||
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
    await this.loadPlugsFromSpace();
  }
}
