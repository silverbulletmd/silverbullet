import { HttpServer, type ServerOptions } from "./http_server.ts";
import { AssetBundle } from "../lib/asset_bundle/bundle.ts";
import { MemoryKvPrimitives } from "../lib/data/memory_kv_primitives.ts";
import { HttpSpacePrimitives } from "../lib/spaces/http_space_primitives.ts";
import { FilteredSpacePrimitives } from "../lib/spaces/filtered_space_primitives.ts";
import { AssetBundlePlugSpacePrimitives } from "../lib/spaces/asset_bundle_space_primitives.ts";
import { determineStorageBackend } from "./storage_backend.ts";
import { CONFIG_TEMPLATE, INDEX_TEMPLATE } from "../web/PAGE_TEMPLATES.ts";

export interface TestServerConfig {
  readOnly?: boolean;
  enableMcp?: boolean;
  mcpAuthMode?: "inherit" | "separate" | "none";
  mcpAuthToken?: string;
  shellBackend?: string;
}

export class TestServerManager {
  private server?: HttpServer;
  private tempDir?: string;
  public port?: number;
  public httpSpacePrimitives?: HttpSpacePrimitives;

  async start(config: TestServerConfig = {}): Promise<void> {
    // Create a temporary directory for testing
    this.tempDir = await Deno.makeTempDir();

    // If read-only mode is requested, create basic pages first
    if (config.readOnly) {
      await this.createBasicPages();
    }

    // Create minimal asset bundles
    const clientAssetBundle = new AssetBundle();
    const plugAssetBundle = new AssetBundle();

    // Create a memory KV store
    const kvPrimitives = new MemoryKvPrimitives();

    // Find an available port
    this.port = 9000 + Math.floor(Math.random() * 1000);

    // Create server options
    const options: ServerOptions = {
      hostname: "localhost",
      port: this.port,
      pagesPath: this.tempDir,
      shellBackend: config.shellBackend ?? "local",
      readOnly: config.readOnly ?? false,
      indexPage: "index",
      hostUrlPrefix: undefined,
    };

    // Add MCP configuration if enabled
    if (config.enableMcp) {
      options.mcp = {
        enabled: true,
        authMode: config.mcpAuthMode ?? "none",
        authToken: config.mcpAuthToken,
      };
    }

    // Create and start the server
    this.server = new HttpServer(
      options,
      clientAssetBundle,
      plugAssetBundle,
      kvPrimitives,
    );
    await this.server.start();

    // Create HTTP space primitives for making requests
    this.httpSpacePrimitives = new HttpSpacePrimitives(
      `http://localhost:${this.port}`,
    );
  }

  private async createBasicPages(): Promise<void> {
    if (!this.tempDir) {
      throw new Error("Temp directory not created");
    }

    // Create a writable space primitives to create basic pages
    const spacePrimitives = new FilteredSpacePrimitives(
      new AssetBundlePlugSpacePrimitives(
        determineStorageBackend(this.tempDir),
        new AssetBundle(),
      ),
      () => true,
    );

    // Create index page
    await spacePrimitives.writeFile("index.md", new TextEncoder().encode(INDEX_TEMPLATE));
    
    // Create config page
    await spacePrimitives.writeFile("CONFIG.md", new TextEncoder().encode(CONFIG_TEMPLATE));
  }


  async stop(): Promise<void> {
    if (this.server) {
      this.server.stop();
      this.server = undefined;
    }

    if (this.tempDir) {
      await Deno.remove(this.tempDir, { recursive: true });
      this.tempDir = undefined;
    }

    this.port = undefined;
    this.httpSpacePrimitives = undefined;
  }

  getBaseUrl(): string {
    if (!this.port) {
      throw new Error("Server not started");
    }
    return `http://localhost:${this.port}`;
  }

  getTempDir(): string {
    if (!this.tempDir) {
      throw new Error("Server not started");
    }
    return this.tempDir;
  }

  getHttpSpacePrimitives(): HttpSpacePrimitives {
    if (!this.httpSpacePrimitives) {
      throw new Error("Server not started");
    }
    return this.httpSpacePrimitives;
  }

  async createTestScript(content: string, filename = "test_script.sh"): Promise<string> {
    if (!this.tempDir) {
      throw new Error("Server not started");
    }

    const scriptPath = `${this.tempDir}/${filename}`;
    await Deno.writeTextFile(scriptPath, content);
    await Deno.chmod(scriptPath, 0o755); // Make executable
    return scriptPath;
  }
}