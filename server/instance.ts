import { SilverBulletHooks } from "../common/manifest.ts";
import { FilteredSpacePrimitives } from "../common/spaces/filtered_space_primitives.ts";
import { SpacePrimitives } from "../common/spaces/space_primitives.ts";
import { ensureSettingsAndIndex } from "../common/util.ts";
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
  private settings?: BuiltinSettings;
  spacePrimitives: SpacePrimitives;

  // Only set when syncOnly == false
  private serverSystem?: ServerSystem;
  system?: System<SilverBulletHooks>;

  constructor(
    private hostname: string,
    public authenticator: Authenticator,
    public shellBackend: ShellBackend,
    public pagesPath: string,
    kvPrimitives?: KvPrimitives,
  ) {
    let fileFilterFn: (s: string) => boolean = () => true;

    this.spacePrimitives = determineStorageBackend(pagesPath);

    // system = undefined in databaseless mode (no PlugOS instance on the server and no DB)
    if (kvPrimitives) {
      // Enable server-side processing
      const serverSystem = new ServerSystem(
        this.spacePrimitives,
        kvPrimitives,
      );
      this.serverSystem = serverSystem;
      this.system = serverSystem.system;
    }

    this.spacePrimitives = new FilteredSpacePrimitives(
      this.spacePrimitives,
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
  }

  async init() {
    if (this.serverSystem) {
      await this.serverSystem.init();
    }

    await this.reloadSettings();
    console.log("Booted server with hostname", this.hostname);
  }

  async reloadSettings() {
    // TODO: Throttle this?
    this.settings = await ensureSettingsAndIndex(this.spacePrimitives);
  }
}
