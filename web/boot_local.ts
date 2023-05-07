import { Editor } from "../web/editor.tsx";
import { ensureAndLoadSettings, safeRun } from "../common/util.ts";
import { Space } from "../common/spaces/space.ts";
import { PlugSpacePrimitives } from "../common/spaces/plug_space_primitives.ts";
import { PageNamespaceHook } from "../common/hooks/page_namespace.ts";
import { SilverBulletHooks } from "../common/manifest.ts";
import { System } from "../plugos/system.ts";
import { BuiltinSettings } from "../web/types.ts";
import { AssetBundlePlugSpacePrimitives } from "../common/spaces/asset_bundle_space_primitives.ts";

import assetBundle from "../dist/asset_bundle.json" assert { type: "json" };
import { AssetBundle } from "../plugos/asset_bundle/bundle.ts";
import {
  ensureTable as ensureStoreTable,
  storeSyscalls,
} from "../plugos/syscalls/store.sqlite.ts";
import {
  ensureTable as ensurePageIndexTable,
  pageIndexSyscalls,
} from "../server/syscalls/index.ts";
import {
  ensureFTSTable,
  fullTextSearchSyscalls,
} from "../plugos/syscalls/fulltext.sqlite.ts";
import { FileMetaSpacePrimitives } from "../common/spaces/file_meta_space_primitives.ts";
import { EventedSpacePrimitives } from "../common/spaces/evented_space_primitives.ts";
import { EventHook } from "../plugos/hooks/event.ts";
import { clientStoreSyscalls } from "./syscalls/clientStore.ts";
import { sandboxFetchSyscalls } from "../plugos/syscalls/fetch.ts";
import { syncSyscalls } from "../common/syscalls/sync.ts";
import { CronHook } from "../plugos/hooks/cron.ts";
import { IndexedDBSpacePrimitives } from "../common/spaces/indexeddb_space_primitives.ts";

safeRun(async () => {
  // Instantiate a PlugOS system for the client
  const system = new System<SilverBulletHooks>();

  // Attach the page namespace hook
  const namespaceHook = new PageNamespaceHook();
  system.addHook(namespaceHook);

  // Event hook
  const eventHook = new EventHook();
  system.addHook(eventHook);

  const cronHook = new CronHook(system);

  system.addHook(cronHook);

  // // for store
  // await ensureStoreTable(db, "store");
  // // for clientStore
  // await ensureStoreTable(db, "localData");
  // await ensurePageIndexTable(db);
  // await ensureFTSTable(db, "fts");

  // const indexSyscalls = pageIndexSyscalls(db);

  const spacePrimitives = //new FileMetaSpacePrimitives(
    new AssetBundlePlugSpacePrimitives(
      new EventedSpacePrimitives(
        new PlugSpacePrimitives(
          new IndexedDBSpacePrimitives(
            "local",
          ),
          namespaceHook,
        ),
        eventHook,
      ),
      new AssetBundle(assetBundle),
    );
  //   indexSyscalls,
  // );

  const space = new Space(spacePrimitives);
  space.watch();

  const settings = await ensureAndLoadSettings(
    space,
    false,
  ) as BuiltinSettings;

  // Register some mobile-specific syscall implementations
  system.registerSyscalls(
    [],
    // storeSyscalls(db, "store"),
    // indexSyscalls,
    // clientStoreSyscalls(db),
    syncSyscalls(spacePrimitives, system),
    // fullTextSearchSyscalls(db, "fts"),
    sandboxFetchSyscalls(),
  );

  console.log("Booting...");

  const editor = new Editor(
    space,
    system,
    eventHook,
    document.getElementById("sb-root")!,
    "",
    settings,
  );

  await editor.init();
});
