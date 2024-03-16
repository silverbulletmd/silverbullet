import { SilverBulletHooks } from "../lib/manifest.ts";
import { ensureAndLoadSettingsAndIndex } from "$common/settings.ts";
import { AssetBundlePlugSpacePrimitives } from "$common/spaces/asset_bundle_space_primitives.ts";
import { FilteredSpacePrimitives } from "$common/spaces/filtered_space_primitives.ts";
import { ReadOnlySpacePrimitives } from "$common/spaces/ro_space_primitives.ts";
import { SpacePrimitives } from "$common/spaces/space_primitives.ts";
import { AssetBundle } from "../lib/asset_bundle/bundle.ts";
import { EventHook } from "../common/hooks/event.ts";
import { DataStore } from "$lib/data/datastore.ts";
import { KvPrimitives } from "$lib/data/kv_primitives.ts";
import { DataStoreMQ } from "$lib/data/mq.datastore.ts";
import { System } from "$lib/plugos/system.ts";
import { BuiltinSettings } from "../type/web.ts";
import { JWTIssuer } from "./crypto.ts";
import { compile as gitIgnoreCompiler } from "gitignore-parser";
import { ServerSystem } from "./server_system.ts";
import { determineShellBackend, NotSupportedShell } from "./shell_backend.ts";
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
  shellBackend: string;
  syncOnly: boolean;
  readOnly: boolean;
  enableSpaceScript: boolean;
  clientEncryption: boolean;
};

// Equivalent of Client on the server
export class SpaceServer {
  public pagesPath: string;
  auth?: { user: string; pass: string };
  authToken?: string;
  hostname: string;

  settings?: BuiltinSettings;
  spacePrimitives!: SpacePrimitives;

  jwtIssuer: JWTIssuer;

  // Only set when syncOnly == false
  private serverSystem?: ServerSystem;
  system?: System<SilverBulletHooks>;
  clientEncryption: boolean;
  syncOnly: boolean;
  readOnly: boolean;
  shellBackend: ShellBackend;
  enableSpaceScript: boolean;

  constructor(
    config: SpaceServerConfig,
    private plugAssetBundle: AssetBundle,
    private kvPrimitives: KvPrimitives,
  ) {
    this.pagesPath = config.pagesPath;
    this.hostname = config.hostname;
    this.auth = config.auth;
    this.authToken = config.authToken;
    this.clientEncryption = !!config.clientEncryption;
    this.syncOnly = config.syncOnly;
    this.readOnly = config.readOnly;
    this.enableSpaceScript = config.enableSpaceScript;

    if (this.clientEncryption) {
      // Sync only will forced on when encryption is enabled
      this.syncOnly = true;
    }

    this.jwtIssuer = new JWTIssuer(kvPrimitives);

    this.shellBackend = config.readOnly
      ? new NotSupportedShell() // No shell for read only mode
      : determineShellBackend(config);
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

    if (this.readOnly) {
      this.spacePrimitives = new ReadOnlySpacePrimitives(this.spacePrimitives);
    }

    const ds = new DataStore(this.kvPrimitives);
    const mq = new DataStoreMQ(ds);

    const eventHook = new EventHook();

    // system = undefined in databaseless mode (no PlugOS instance on the server and no DB)
    if (!this.syncOnly) {
      // Enable server-side processing
      const serverSystem = new ServerSystem(
        this.spacePrimitives,
        this.kvPrimitives,
        this.shellBackend,
        mq,
        ds,
        eventHook,
        this.readOnly,
        this.enableSpaceScript,
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
      this.settings = await ensureAndLoadSettingsAndIndex(this.spacePrimitives);
    } else {
      this.settings = {
        indexPage: "index",
        actionButtons: [],
      };
    }
  }
}
