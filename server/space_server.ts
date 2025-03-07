import type { SilverBulletHooks } from "../lib/manifest.ts";
import {
  ensureAndLoadSettingsAndIndex,
  updateObjectDecorators,
} from "../common/config.ts";
import { AssetBundlePlugSpacePrimitives } from "$common/spaces/asset_bundle_space_primitives.ts";
import { FilteredSpacePrimitives } from "$common/spaces/filtered_space_primitives.ts";
import { ReadOnlySpacePrimitives } from "$common/spaces/ro_space_primitives.ts";
import type { SpacePrimitives } from "$common/spaces/space_primitives.ts";
import type { AssetBundle } from "../lib/asset_bundle/bundle.ts";
import { EventHook } from "../common/hooks/event.ts";
import { DataStore } from "$lib/data/datastore.ts";
import type { KvPrimitives } from "$lib/data/kv_primitives.ts";
import { DataStoreMQ } from "$lib/data/mq.datastore.ts";
import type { System } from "$lib/plugos/system.ts";
import { JWTIssuer } from "./crypto.ts";
import { compile as gitIgnoreCompiler } from "gitignore-parser";
import { ServerSystem } from "./server_system.ts";
import { determineShellBackend, NotSupportedShell } from "./shell_backend.ts";
import type { ShellBackend } from "./shell_backend.ts";
import { determineStorageBackend } from "./storage_backend.ts";
import {
  type Config,
  type ConfigContainer,
  defaultConfig,
} from "../type/config.ts";
import type { ServerOptions } from "./http_server.ts";
import type { AuthOptions } from "../cmd/server.ts";

// Equivalent of Client on the server
export class SpaceServer implements ConfigContainer {
  public pagesPath: string;
  auth?: AuthOptions;
  hostname: string;

  config: Config;
  spacePrimitives!: SpacePrimitives;

  jwtIssuer: JWTIssuer;

  // Only set when syncOnly == false
  serverSystem?: ServerSystem;
  system?: System<SilverBulletHooks>;
  syncOnly: boolean;
  readOnly: boolean;
  shellBackend: ShellBackend;
  enableSpaceScript: boolean;
  indexPage: string;
  spaceIgnore?: string;

  constructor(
    options: ServerOptions,
    private plugAssetBundle: AssetBundle,
    private kvPrimitives: KvPrimitives,
  ) {
    this.pagesPath = options.pagesPath;
    this.hostname = options.hostname;
    this.auth = options.auth;
    this.syncOnly = options.syncOnly;
    this.readOnly = options.readOnly;
    this.indexPage = options.indexPage;
    this.config = defaultConfig;
    this.enableSpaceScript = options.enableSpaceScript;
    this.spaceIgnore = options.spaceIgnore;

    this.jwtIssuer = new JWTIssuer(kvPrimitives);

    this.shellBackend = options.readOnly
      ? new NotSupportedShell() // No shell for read only mode
      : determineShellBackend(options);
  }

  async init() {
    let fileFilterFn: (s: string) => boolean = () => true;
    if (this.spaceIgnore) {
      fileFilterFn = gitIgnoreCompiler(this.spaceIgnore).accepts;
    }

    this.spacePrimitives = new FilteredSpacePrimitives(
      new AssetBundlePlugSpacePrimitives(
        await determineStorageBackend(this.kvPrimitives, this.pagesPath),
        this.plugAssetBundle,
      ),
      (meta) => fileFilterFn(meta.name),
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
        this,
      );
      this.serverSystem = serverSystem;
    }

    if (this.auth) {
      // Initialize JWT issuer
      await this.jwtIssuer.init(
        JSON.stringify({ auth: this.auth }),
      );
    }

    if (this.serverSystem) {
      await this.serverSystem.init();
      this.system = this.serverSystem.system;
      // Swap in the space primitives from the server system
      this.spacePrimitives = this.serverSystem.spacePrimitives;
    }

    await this.loadConfig();
    console.log("Booted server with hostname", this.hostname);
  }

  async loadConfig() {
    this.config = await ensureAndLoadSettingsAndIndex(
      this.spacePrimitives,
      this.system,
    );

    if (this.serverSystem) {
      updateObjectDecorators(this.config, this.serverSystem.ds);
      this.serverSystem.eventHook.dispatchEvent("config:loaded", this.config);
    }
  }
}
