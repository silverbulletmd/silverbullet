import { AssetBundlePlugSpacePrimitives } from "$common/spaces/asset_bundle_space_primitives.ts";
import { FilteredSpacePrimitives } from "$common/spaces/filtered_space_primitives.ts";
import { ReadOnlySpacePrimitives } from "$common/spaces/ro_space_primitives.ts";
import type { SpacePrimitives } from "$common/spaces/space_primitives.ts";
import type { AssetBundle } from "../lib/asset_bundle/bundle.ts";
import type { KvPrimitives } from "$lib/data/kv_primitives.ts";
import { JWTIssuer } from "./crypto.ts";
import { compile as gitIgnoreCompiler } from "gitignore-parser";
import { determineShellBackend, NotSupportedShell } from "./shell_backend.ts";
import type { ShellBackend } from "./shell_backend.ts";
import { determineStorageBackend } from "./storage_backend.ts";
import type { ServerOptions } from "./http_server.ts";
import type { AuthOptions } from "../cmd/server.ts";

// Equivalent of Client on the server
export class SpaceServer {
  public pagesPath: string;
  auth?: AuthOptions;
  hostname: string;

  spacePrimitives!: SpacePrimitives;

  jwtIssuer: JWTIssuer;

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
    this.readOnly = options.readOnly;
    this.indexPage = options.indexPage;
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

    if (this.auth) {
      // Initialize JWT issuer
      await this.jwtIssuer.init(
        JSON.stringify({ auth: this.auth }),
      );
    }

    console.log("Booted server with hostname", this.hostname);
  }
}
