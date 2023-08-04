import { path } from "../common/deps.ts";
import { PlugNamespaceHook } from "../common/hooks/plug_namespace.ts";
import { SilverBulletHooks } from "../common/manifest.ts";
import { loadMarkdownExtensions } from "../common/markdown_parser/markdown_ext.ts";
import buildMarkdown from "../common/markdown_parser/parser.ts";
import { DiskSpacePrimitives } from "../common/spaces/disk_space_primitives.ts";
import { EventedSpacePrimitives } from "../common/spaces/evented_space_primitives.ts";
import { FileMetaSpacePrimitives } from "../common/spaces/file_meta_space_primitives.ts";
import { PlugSpacePrimitives } from "../common/spaces/plug_space_primitives.ts";
import { AssetBundle } from "../plugos/asset_bundle/bundle.ts";
import { createSandbox } from "../plugos/environments/deno_sandbox.ts";
import { CronHook } from "../plugos/hooks/cron.ts";
import { EventHook } from "../plugos/hooks/event.ts";
import { JSONKVStore } from "../plugos/lib/kv_store.json_file.ts";
import assetSyscalls from "../plugos/syscalls/asset.ts";
import { eventSyscalls } from "../plugos/syscalls/event.ts";
import { sandboxFetchSyscalls } from "../plugos/syscalls/fetch.ts";
import { shellSyscalls } from "../plugos/syscalls/shell.deno.ts";
import { storeSyscalls } from "../plugos/syscalls/store.ts";
import { System } from "../plugos/system.ts";
import { Space } from "../web/space.ts";
import { debugSyscalls } from "../web/syscalls/debug.ts";
import { markdownSyscalls } from "../web/syscalls/markdown.ts";
import { systemSyscalls } from "../web/syscalls/system.ts";
import { yamlSyscalls } from "../web/syscalls/yaml.ts";
import { pageIndexSyscalls } from "./syscalls/index.ts";
import { spaceSyscalls } from "./syscalls/space.ts";

export async function runPlug(
  spacePath: string,
  functionName: string,
  args: string[] = [],
  builtinAssetBundle: AssetBundle,
  indexFirst = false,
) {
  spacePath = path.resolve(spacePath);
  const system = new System<SilverBulletHooks>("cli");

  // Event hook
  const eventHook = new EventHook();
  system.addHook(eventHook);

  // Cron hook
  const cronHook = new CronHook(system);
  system.addHook(cronHook);

  const pageIndexCalls = pageIndexSyscalls("run.db");

  // TODO: Add endpoint

  const plugNamespaceHook = new PlugNamespaceHook();
  system.addHook(plugNamespaceHook);

  const spacePrimitives = new FileMetaSpacePrimitives(
    new EventedSpacePrimitives(
      new PlugSpacePrimitives(
        new DiskSpacePrimitives(spacePath),
        plugNamespaceHook,
      ),
      eventHook,
    ),
    pageIndexCalls,
  );
  const kvStore = new JSONKVStore();
  const space = new Space(spacePrimitives, kvStore);

  // Add syscalls
  system.registerSyscalls(
    [],
    eventSyscalls(eventHook),
    spaceSyscalls(space),
    assetSyscalls(system),
    yamlSyscalls(),
    storeSyscalls(kvStore),
    systemSyscalls(undefined as any, system),
    pageIndexCalls,
    debugSyscalls(),
    markdownSyscalls(buildMarkdown([])), // Will later be replaced with markdown extensions
  );

  // Syscalls that require some additional permissions
  system.registerSyscalls(
    ["fetch"],
    sandboxFetchSyscalls(),
  );

  system.registerSyscalls(
    ["shell"],
    shellSyscalls("."),
  );

  await loadPlugsFromAssetBundle(system, builtinAssetBundle);

  for (let plugPath of await space.listPlugs()) {
    plugPath = path.resolve(spacePath, plugPath);
    await system.load(
      new URL(`file://${plugPath}`),
      createSandbox,
    );
  }

  // Load markdown syscalls based on all new syntax (if any)
  system.registerSyscalls(
    [],
    markdownSyscalls(buildMarkdown(loadMarkdownExtensions(system))),
  );

  if (indexFirst) {
    await system.loadedPlugs.get("core")!.invoke("reindexSpace", []);
  }

  const [plugName, funcName] = functionName.split(".");

  const plug = system.loadedPlugs.get(plugName);
  if (!plug) {
    throw new Error(`Plug ${plugName} not found`);
  }
  const result = await plug.invoke(funcName, args);

  await system.unloadAll();
  await pageIndexCalls["index.close"]({} as any);
  return result;
}

async function loadPlugsFromAssetBundle(
  system: System<any>,
  assetBundle: AssetBundle,
) {
  const tempDir = await Deno.makeTempDir();
  try {
    for (const filePath of assetBundle.listFiles()) {
      if (filePath.endsWith(".plug.js")) {
        const plugPath = path.join(tempDir, filePath);
        await Deno.mkdir(path.dirname(plugPath), { recursive: true });
        await Deno.writeFile(plugPath, assetBundle.readFileSync(filePath));
        await system.load(
          new URL(`file://${plugPath}`),
          createSandbox,
        );
      }
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
}
