import { AssetBundlePlugSpacePrimitives } from "../lib/spaces/asset_bundle_space_primitives.ts";
import { FilteredSpacePrimitives } from "../lib/spaces/filtered_space_primitives.ts";
import { ReadOnlySpacePrimitives } from "../lib/spaces/ro_space_primitives.ts";
import type { SpacePrimitives } from "../lib/spaces/space_primitives.ts";
import type { AssetBundle } from "../lib/asset_bundle/bundle.ts";
import type { KvPrimitives } from "$lib/data/kv_primitives.ts";
import { JWTIssuer } from "./crypto.ts";
import { compile as gitIgnoreCompiler } from "gitignore-parser";
import { determineShellBackend, NotSupportedShell } from "./shell_backend.ts";
import type { ShellBackend } from "./shell_backend.ts";
import { determineStorageBackend } from "./storage_backend.ts";
import type { ServerOptions } from "./http_server.ts";
import type { AuthOptions } from "../cmd/server.ts";
import { CONFIG_TEMPLATE, INDEX_TEMPLATE } from "../web/PAGE_TEMPLATES.ts";

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
        determineStorageBackend(this.pagesPath),
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

    await this.ensureBasicPages();

    console.log("Booted server with hostname", this.hostname);
  }

  async ensureBasicPages() {
    await this.ensurePageWithContent(`${this.indexPage}.md`, INDEX_TEMPLATE);

    const files = await this.spacePrimitives.fetchFileList();
    const hasConfig = files.some(
      (f) => f.name === "CONFIG.md" || f.name.endsWith("/CONFIG.md"),
    );
    if (!hasConfig) {
      await this.ensurePageWithContent("CONFIG.md", CONFIG_TEMPLATE);
    }
  }

  private async ensurePageWithContent(path: string, content: string) {
    try {
      // This will blow up if the page doesn't exist
      await this.spacePrimitives.getFileMeta(path);
    } catch (e: any) {
      if (e.message === "Not found") {
        console.info(path, "page not found, creating...");
        await this.spacePrimitives.writeFile(
          path,
          new TextEncoder().encode(content),
        );
      } else {
        throw e;
      }
    }
  }
}
