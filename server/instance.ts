import { AssetBundlePlugSpacePrimitives } from "../common/spaces/asset_bundle_space_primitives.ts";
import { SpacePrimitives } from "../common/spaces/space_primitives.ts";
import { AssetBundle } from "../plugos/asset_bundle/bundle.ts";
import type { DataStore } from "../plugos/lib/datastore.ts";
import { KvDataStore } from "../plugos/lib/kv_datastore.ts";
import { KvPrimitives } from "../plugos/lib/kv_primitives.ts";
import { PrefixedKvPrimitives } from "../plugos/lib/prefixed_kv_primitives.ts";
import { JWTIssuer } from "./crypto.ts";
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

  // private settings?: BuiltinSettings;
  spacePrimitives!: SpacePrimitives;

  jwtIssuer: JWTIssuer;

  clientEncryption: boolean;
  syncOnly: boolean;
  ds: DataStore;

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
    this.ds = new KvDataStore(new PrefixedKvPrimitives(kvPrimitives, ["ds"]));
  }

  async init() {
    this.spacePrimitives = new AssetBundlePlugSpacePrimitives(
      await determineStorageBackend(this.kvPrimitives, this.pagesPath),
      this.plugAssetBundle,
    );

    if (this.auth) {
      // Initialize JWT issuer
      await this.jwtIssuer.init(
        JSON.stringify({ auth: this.auth, authToken: this.authToken }),
      );
    }

    console.log("Booted server with hostname", this.hostname);
  }
}
