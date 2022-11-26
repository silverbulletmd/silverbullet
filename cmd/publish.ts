#!/usr/bin/env node
import { createSandbox } from "../plugos/environments/deno_sandbox.ts";
import { EventHook } from "../plugos/hooks/event.ts";
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
} from "../plugos/syscalls/store.deno.ts";
import { System } from "../plugos/system.ts";
import { SilverBulletHooks } from "../common/manifest.ts";
import { loadMarkdownExtensions } from "../common/markdown_ext.ts";
import buildMarkdown from "../common/parser.ts";
import { DiskSpacePrimitives } from "../common/spaces/disk_space_primitives.ts";
import { EventedSpacePrimitives } from "../common/spaces/evented_space_primitives.ts";
import { Space } from "../common/spaces/space.ts";
import { markdownSyscalls } from "../common/syscalls/markdown.ts";
import { PageNamespaceHook } from "../server/hooks/page_namespace.ts";
import { PlugSpacePrimitives } from "../server/hooks/plug_space_primitives.ts";
import {
  ensureTable as ensureIndexTable,
  pageIndexSyscalls,
} from "../server/syscalls/index.ts";
import spaceSyscalls from "../server/syscalls/space.ts";

import assetBundle from "../dist/asset_bundle.json" assert { type: "json" };
import { AssetBundle, AssetJson } from "../plugos/asset_bundle/bundle.ts";
import { path } from "../server/deps.ts";
import { AsyncSQLite } from "../plugos/sqlite/async_sqlite.ts";
import { AssetBundlePlugSpacePrimitives } from "../common/spaces/asset_bundle_space_primitives.ts";
import assetSyscalls from "../plugos/syscalls/asset.ts";

export async function publishCommand(options: {
  index: boolean;
  watch: boolean;
  output: string;
}, pagesPath: string) {
  const assets = new AssetBundle(assetBundle as AssetJson);
  // Set up the PlugOS System
  const system = new System<SilverBulletHooks>("server");

  // Instantiate the event bus hook
  const eventHook = new EventHook();
  system.addHook(eventHook);

  // And the page namespace hook
  const namespaceHook = new PageNamespaceHook();
  system.addHook(namespaceHook);

  pagesPath = path.resolve(pagesPath);

  // The space
  const space = new Space(
    new AssetBundlePlugSpacePrimitives(
      new EventedSpacePrimitives(
        new PlugSpacePrimitives(
          new DiskSpacePrimitives(pagesPath),
          namespaceHook,
          "server",
        ),
        eventHook,
      ),
      assets,
    ),
  );

  await space.updatePageList();

  // The database used for persistence (SQLite)
  const db = new AsyncSQLite(path.join(pagesPath, "publish-data.db"));
  db.init().catch((e) => {
    console.error("Error initializing database", e);
  });

  // Register syscalls available on the server side
  system.registerSyscalls(
    [],
    pageIndexSyscalls(db),
    storeSyscalls(db, "store"),
    fullTextSearchSyscalls(db, "fts"),
    spaceSyscalls(space),
    eventSyscalls(eventHook),
    markdownSyscalls(buildMarkdown([])),
    sandboxSyscalls(system),
    assetSyscalls(system),
  );
  // Danger zone
  system.registerSyscalls(["shell"], shellSyscalls(pagesPath));
  system.registerSyscalls(["fs"], fileSystemSyscalls("/"));

  const globalModules = JSON.parse(
    assets.readTextFileSync(`web/global.plug.json`),
  );

  system.on({
    sandboxInitialized: async (sandbox) => {
      for (
        const [modName, code] of Object.entries(
          globalModules.dependencies,
        )
      ) {
        await sandbox.loadDependency(modName, code as string);
      }
    },
  });

  await space.updatePageList();

  const allPlugs = await space.listPlugs();

  console.log("Loading plugs", allPlugs);
  await Promise.all((await space.listPlugs()).map(async (plugName) => {
    const { data } = await space.readAttachment(plugName, "string");
    await system.load(JSON.parse(data as string), createSandbox);
  }));

  const corePlug = system.loadedPlugs.get("core");
  if (!corePlug) {
    console.error("Something went very wrong, 'core' plug not found");
    return;
  }

  system.registerSyscalls(
    [],
    markdownSyscalls(buildMarkdown(loadMarkdownExtensions(system))),
  );

  await ensureIndexTable(db);
  await ensureStoreTable(db, "store");
  await ensureFTSTable(db, "fts");

  if (options.index) {
    console.log("Now indexing space");
    await corePlug.invoke("reindexSpace", []);
  }

  const outputDir = path.resolve(options.output);

  await Deno.mkdir(outputDir, { recursive: true });

  const publishPlug = system.loadedPlugs.get("publish")!;

  await publishPlug.invoke("publishAll", [outputDir]);

  if (options.watch) {
    console.log("Watching for changes");
    let building = false;
    for await (const _event of Deno.watchFs(pagesPath, { recursive: true })) {
      console.log("Change detected, republishing");
      if (building) {
        continue;
      }
      building = true;
      space.updatePageList().then(async () => {
        await publishPlug.invoke("publishAll", [outputDir]);
        building = false;
      });
    }
  } else {
    console.log("Done!");
    Deno.exit(0);
    //   process.exit(0);
  }
}
