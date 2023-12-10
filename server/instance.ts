import { SilverBulletHooks } from "../common/manifest.ts";
import { AssetBundlePlugSpacePrimitives } from "../common/spaces/asset_bundle_space_primitives.ts";
import { FilteredSpacePrimitives } from "../common/spaces/filtered_space_primitives.ts";
import { SpacePrimitives } from "../common/spaces/space_primitives.ts";
import { ensureSettingsAndIndex } from "../common/util.ts";
import { AssetBundle } from "../plugos/asset_bundle/bundle.ts";
import { KvPrimitives } from "../plugos/lib/kv_primitives.ts";
import { System } from "../plugos/system.ts";
import { BuiltinSettings } from "../web/types.ts";
import { Authenticator } from "./auth.ts";
import { gitIgnoreCompiler } from "./deps.ts";
import { ServerSystem } from "./server_system.ts";
import { ShellBackend } from "./shell_backend.ts";
import { determineStorageBackend } from "./storage_backend.ts";

export type SpaceServerConfig = {
  hostname: string;
  namespace: string;
  authenticator: Authenticator;
  pagesPath: string;
};

export class SpaceServer {
  public pagesPath: string;
  authenticator: Authenticator;
  hostname: string;

  private settings?: BuiltinSettings;
  spacePrimitives: SpacePrimitives;

  // Only set when syncOnly == false
  private serverSystem?: ServerSystem;
  system?: System<SilverBulletHooks>;

  constructor(
    config: SpaceServerConfig,
    public shellBackend: ShellBackend,
    plugAssetBundle: AssetBundle,
    kvPrimitives?: KvPrimitives,
  ) {
    this.pagesPath = config.pagesPath;
    this.authenticator = config.authenticator;
    this.hostname = config.hostname;

    let fileFilterFn: (s: string) => boolean = () => true;

    this.spacePrimitives = new FilteredSpacePrimitives(
      new AssetBundlePlugSpacePrimitives(
        determineStorageBackend(this.pagesPath),
        plugAssetBundle,
      ),
      (meta) => fileFilterFn(meta.name),
      async () => {
        await this.reloadSettings();
        if (typeof this.settings?.spaceIgnore === "string") {
          fileFilterFn = gitIgnoreCompiler(this.settings.spaceIgnore).accepts;
        } else {
          fileFilterFn = () => true;
        }
      },
    );

    // system = undefined in databaseless mode (no PlugOS instance on the server and no DB)
    if (kvPrimitives) {
      // Enable server-side processing
      const serverSystem = new ServerSystem(
        this.spacePrimitives,
        kvPrimitives,
      );
      this.serverSystem = serverSystem;
    }
  }

  async init() {
    if (this.serverSystem) {
      await this.serverSystem.init();
      this.system = this.serverSystem.system;
    }

    await this.reloadSettings();
    console.log("Booted server with hostname", this.hostname);
  }

  async reloadSettings() {
    // TODO: Throttle this?
    this.settings = await ensureSettingsAndIndex(this.spacePrimitives);
  }
}
