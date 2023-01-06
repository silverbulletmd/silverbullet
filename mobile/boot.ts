import { Editor } from "../web/editor.tsx";
import { parseYamlSettings, safeRun } from "../common/util.ts";
import { Space } from "../common/spaces/space.ts";
import { PlugSpacePrimitives } from "../server/hooks/plug_space_primitives.ts";
import { PageNamespaceHook } from "../server/hooks/page_namespace.ts";
import { SilverBulletHooks } from "../common/manifest.ts";
import { System } from "../plugos/system.ts";
import { BuiltinSettings } from "../web/types.ts";
import { Capacitor, Directory } from "./deps.ts";
import { CapacitorSpacePrimitives } from "./spaces/capacitor_space_primitives.ts";
import { AssetBundlePlugSpacePrimitives } from "../common/spaces/asset_bundle_space_primitives.ts";

import assetBundle from "../dist/asset_bundle.json" assert { type: "json" };
import { SpacePrimitives } from "../common/spaces/space_primitives.ts";
import { AssetBundle } from "../plugos/asset_bundle/bundle.ts";

safeRun(async () => {
  const mobileSpacePrimitives = new CapacitorSpacePrimitives(
    Directory.Documents,
    "",
  );
  let settingsPageText = "";
  try {
    settingsPageText = (
      await mobileSpacePrimitives.readFile("SETTINGS.md", "string")
    ).data as string;
  } catch (e: any) {
    console.error("No settings page found", e.message);
  }

  // Instantiate a PlugOS system for the client
  const system = new System<SilverBulletHooks>("client");

  // Attach the page namespace hook
  const namespaceHook = new PageNamespaceHook();
  system.addHook(namespaceHook);

  let spacePrimitives: SpacePrimitives = new PlugSpacePrimitives(
    mobileSpacePrimitives,
    namespaceHook,
    "client",
  );

  // wrap in the asset bundle (_plug files)
  spacePrimitives = new AssetBundlePlugSpacePrimitives(
    spacePrimitives,
    new AssetBundle(assetBundle),
  );

  const serverSpace = new Space(spacePrimitives);
  serverSpace.watch();

  // Register some mobile-specific syscall implementations
  // system.registerSyscalls(
  //   [],
  //   storeSyscalls(serverSpace),
  //   indexerSyscalls(serverSpace),
  //   fulltextSyscalls(serverSpace),
  // );

  console.log("Booting...");

  const settings = parseYamlSettings(settingsPageText) as BuiltinSettings;

  if (!settings.indexPage) {
    settings.indexPage = "index";
  }

  const editor = new Editor(
    serverSpace,
    system,
    document.getElementById("sb-root")!,
    "",
    settings,
  );
  // @ts-ignore: for convenience
  window.editor = editor;

  await editor.init();
});
