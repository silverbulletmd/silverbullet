import { HttpServer } from "../server/http_server.ts";

// To ship silverbullet as a single binary, we're importing all assets (client and plugs) as JSON blobs
import clientAssetBundle from "../dist/client_asset_bundle.json" with {
  type: "json",
};
import plugAssetBundle from "../dist/plug_asset_bundle.json" with {
  type: "json",
};

import { AssetBundle, type AssetJson } from "../lib/asset_bundle/bundle.ts";

import { resolve } from "@std/path";
import { sleep } from "../lib/async.ts";
import { MemoryKvPrimitives } from "../lib/data/memory_kv_primitives.ts";

export type AuthOptions = {
  authToken?: string;
  user: string;
  pass: string;
  lockoutTime: number;
  lockoutLimit: number;
};

export async function serveCommand(
  options: {
    hostname?: string;
    port?: number;
    user?: string;
    auth?: string;
  },
  folder?: string,
) {
  const hostname = options.hostname || Deno.env.get("SB_HOSTNAME") ||
    "127.0.0.1";
  const port = options.port ||
    (Deno.env.get("SB_PORT") && +Deno.env.get("SB_PORT")!) || 3000;

  const readOnly = !!Deno.env.get("SB_READ_ONLY");

  const indexPage = Deno.env.get("SB_INDEX_PAGE") || "index";

  folder = folder || Deno.env.get("SB_FOLDER");
  if (!folder) {
    console.error(
      "No folder specified. Please pass a folder as an argument or set SB_FOLDER environment variable.",
    );
    Deno.exit(1);
  }

  // This database is only used to store some auth based temporary values
  let dbFile = Deno.env.get("SB_KV_DB") || ".silverbullet.db.json";
  dbFile = resolve(folder, dbFile);

  console.info(
    `Storing database in ${dbFile}.`,
  );
  const baseKvPrimitives = new MemoryKvPrimitives(dbFile);
  await baseKvPrimitives.init();

  console.info("Starting SilverBullet binding to", `${hostname}:${port}`);
  if (hostname === "127.0.0.1") {
    console.info(
      `SilverBullet will only be available locally, to allow outside connections, pass -L0.0.0.0 as a flag, and put a TLS terminator on top.`,
    );
  }

  let hostUrlPrefix = Deno.env.get("SB_URL_PREFIX");
  if (hostUrlPrefix) {
    // Normalize the host URL prefix (if set)
    if (!hostUrlPrefix.startsWith("/")) {
      hostUrlPrefix = "/" + hostUrlPrefix;
    }
    if (hostUrlPrefix.endsWith("/")) {
      hostUrlPrefix = hostUrlPrefix.replace(/\/*$/, "");
    }

    if (hostUrlPrefix !== "") {
      console.log(`Host URL Prefix: ${hostUrlPrefix}`);
    } else {
      hostUrlPrefix = undefined;
    }
  }

  // Built-in authentication setup
  const userAuth = options.user || Deno.env.get("SB_USER");
  let userCredentials: AuthOptions | undefined;
  if (userAuth) {
    const [user, pass] = userAuth.split(":");
    userCredentials = {
      user,
      pass,
      authToken: Deno.env.get("SB_AUTH_TOKEN"),
      // Default lockout: 10 failed login attempts in 1 minute
      lockoutLimit: Deno.env.get("SB_LOCKOUT_LIMIT")
        ? Number(Deno.env.get("SB_LOCKOUT_LIMIT"))
        : 10,
      lockoutTime: Deno.env.get("SB_LOCKOUT_TIME")
        ? Number(Deno.env.get("SB_LOCKOUT_TIME"))
        : 60,
    };
    console.log(
      `User authentication enabled for user "${user}" with lockout limit ${userCredentials.lockoutLimit} and lockout time ${userCredentials.lockoutTime}s`,
    );
  }

  const shellBackend = Deno.env.get("SB_SHELL_BACKEND") || "local";
  const spaceIgnore = Deno.env.get("SB_SPACE_IGNORE");

  // All plug code bundled into a JSON blob
  const plugAssets = new AssetBundle(plugAssetBundle as AssetJson);
  // All client files bundled into a JSON blob
  const clientAssets = new AssetBundle(clientAssetBundle as AssetJson);

  // Manifest configuration
  buildPWAManifest(hostUrlPrefix, clientAssets);

  // Build the web server
  const httpServer = new HttpServer(
    {
      hostname,
      port,
      hostUrlPrefix,
      indexPage,
      spaceIgnore,
      auth: userCredentials,
      readOnly,
      shellBackend,
      pagesPath: folder,
    },
    clientAssets,
    plugAssets,
    baseKvPrimitives,
  );

  // And kick it off
  await httpServer.start();

  // Wait in an infinite loop (to keep the HTTP server running, only cancelable via Ctrl+C or other signal)
  while (true) {
    await sleep(10000);
  }
}

/**
 * Overrides SilverBullet's manifest.json dynamically based on some (optional) environment variables
 */
function buildPWAManifest(
  hostUrlPrefix: string | undefined,
  clientAssets: AssetBundle,
) {
  const manifestName = Deno.env.get("SB_NAME");
  const manifestDescription = Deno.env.get("SB_DESCRIPTION");

  // Parse the default manifest.json
  const manifestData = JSON.parse(
    clientAssets.readTextFileSync(".client/manifest.json"),
  );
  if (manifestName) {
    manifestData.name = manifestData.short_name = manifestName;
  }
  if (manifestDescription) {
    manifestData.description = manifestDescription;
  }
  if (hostUrlPrefix) {
    for (const icon of manifestData.icons) {
      if (icon.src) icon.src = hostUrlPrefix + icon.src;
    }
    manifestData.start_url = hostUrlPrefix + manifestData.start_url;
    manifestData.scope = hostUrlPrefix + manifestData.scope;
  }
  // Write it back into the asset bundle to be served by the HTTP server
  clientAssets.writeTextFileSync(
    ".client/manifest.json",
    "application/json",
    JSON.stringify(manifestData),
  );
}
