import { SilverBulletHooks } from "../common/manifest.ts";
import { AssetBundlePlugSpacePrimitives } from "../common/spaces/asset_bundle_space_primitives.ts";
import { FilteredSpacePrimitives } from "../common/spaces/filtered_space_primitives.ts";
import { SpacePrimitives } from "../common/spaces/space_primitives.ts";
import { ensureSettingsAndIndex } from "../common/util.ts";
import { AssetBundle } from "../plugos/asset_bundle/bundle.ts";
import { KvPrimitives } from "../plugos/lib/kv_primitives.ts";
import { System } from "../plugos/system.ts";
import { BuiltinSettings } from "../web/types.ts";
import { JWTIssuer } from "./crypto.ts";
import { gitIgnoreCompiler } from "./deps.ts";
import { ServerSystem } from "./server_system.ts";
import { ShellBackend } from "./shell_backend.ts";
import { determineStorageBackend } from "./storage_backend.ts";

export type SpaceServerConfig = {
  hostname: string;
  namespace: string;
  // Enable username/password auth
  auth?: { user: string; pass: string };
  // Additional API auth token
  authToken?: string;
  pagesPath: string;
  syncOnly?: boolean;
  clientEncryption?: boolean;
};

export class SpaceServer {
  public pagesPath: string;
  auth?: { user: string; pass: string };
  authToken?: string;
  hostname: string;

  private settings?: BuiltinSettings;
  spacePrimitives!: SpacePrimitives;

  jwtIssuer: JWTIssuer;

  // Only set when syncOnly == false
  private serverSystem?: ServerSystem;
  system?: System<SilverBulletHooks>;
  clientEncryption: boolean;
  syncOnly: boolean;

  constructor(
    config: SpaceServerConfig,
    public shellBackend: ShellBackend,
    private plugAssetBundle: AssetBundle,
    private kvPrimitives: KvPrimitives,
  ) {
    this.pagesPath = config.pagesPath;
    this.hostname = config.hostname;
    this.auth = config.auth;
    this.authToken = config.authToken;
    this.clientEncryption = !!config.clientEncryption;
    this.syncOnly = !!config.syncOnly;
    if (this.clientEncryption) {
      // Sync only will forced on when encryption is enabled
      this.syncOnly = true;
    }

    this.jwtIssuer = new JWTIssuer(kvPrimitives);
  }

  async init() {
    let fileFilterFn: (s: string) => boolean = () => true;

    this.spacePrimitives = new FilteredSpacePrimitives(
      new AssetBundlePlugSpacePrimitives(
        await determineStorageBackend(this.kvPrimitives, this.pagesPath),
        this.plugAssetBundle,
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
    if (!this.syncOnly) {
      // Enable server-side processing
      const serverSystem = new ServerSystem(
        this.spacePrimitives,
        this.kvPrimitives,
        this.shellBackend,
      );
      this.serverSystem = serverSystem;
    }

    if (this.auth) {
      // Initialize JWT issuer
      await this.jwtIssuer.init(
        JSON.stringify({ auth: this.auth, authToken: this.authToken }),
      );
    }

    if (this.serverSystem) {
      await this.serverSystem.init();
      this.system = this.serverSystem.system;
      // Swap in the space primitives from the server system
      this.spacePrimitives = this.serverSystem.spacePrimitives;
    }

    await this.reloadSettings();
    console.log("Booted server with hostname", this.hostname);
  }

  async reloadSettings() {
    if (!this.clientEncryption) {
      // Only attempt this when the space is not encrypted
      this.settings = await ensureSettingsAndIndex(this.spacePrimitives);
    } else {
      this.settings = {
        indexPage: "index",
      };
    }
  }
}
