import { HttpServer } from "../server/http_server.ts";
import clientAssetBundle from "../dist/client_asset_bundle.json" with {
  type: "json",
};
import plugAssetBundle from "../dist/plug_asset_bundle.json" with {
  type: "json",
};
import { AssetBundle, type AssetJson } from "../lib/asset_bundle/bundle.ts";

import { determineDatabaseBackend } from "../server/db_backend.ts";
import { sleep } from "../lib/async.ts";

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
    cert?: string;
    key?: string;
    reindex?: boolean;
  },
  folder?: string,
) {
  const hostname = options.hostname || Deno.env.get("SB_HOSTNAME") ||
    "127.0.0.1";
  const port = options.port ||
    (Deno.env.get("SB_PORT") && +Deno.env.get("SB_PORT")!) || 3000;

  const readOnly = !!Deno.env.get("SB_READ_ONLY");

  const indexPage = Deno.env.get("SB_INDEX_PAGE") || "index";

  if (!folder) {
    // Didn't get a folder as an argument, check if we got it as an environment variable
    folder = Deno.env.get("SB_FOLDER");
    if (!folder) {
      console.error(
        "No folder specified. Please pass a folder as an argument or set SB_FOLDER environment variable.",
      );
      Deno.exit(1);
    }
  }

  const baseKvPrimitives = await determineDatabaseBackend(folder);

  console.log(
    "Going to start SilverBullet binding to",
    `${hostname}:${port}`,
  );
  if (hostname === "127.0.0.1") {
    console.info(
      `SilverBullet will only be available locally, to allow outside connections, pass -L0.0.0.0 as a flag, and put a TLS terminator on top.`,
    );
  }

  let hostUrlPrefix = Deno.env.get("SB_URL_PREFIX");
  if (hostUrlPrefix) {
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

  const userAuth = options.user ?? Deno.env.get("SB_USER");

  let userCredentials: AuthOptions | undefined;
  if (userAuth) {
    const [user, pass] = userAuth.split(":");
    userCredentials = {
      user,
      pass,
      // 10 failed login attempts in 1 minute
      lockoutLimit: 10,
      lockoutTime: 60,
    };
    // Override lockout settings if they are set in the environment
    if (Deno.env.get("SB_LOCKOUT_LIMIT")) {
      userCredentials.lockoutLimit = Number(Deno.env.get("SB_LOCKOUT_LIMIT"));
    }
    if (Deno.env.get("SB_LOCKOUT_TIME")) {
      userCredentials.lockoutTime = Number(Deno.env.get("SB_LOCKOUT_TIME"));
    }
    if (Deno.env.get("SB_AUTH_TOKEN")) {
      userCredentials.authToken = Deno.env.get("SB_AUTH_TOKEN");
    }
    console.log(
      `User authentication enabled for user "${user}" with lockout limit ${userCredentials.lockoutLimit} and lockout time ${userCredentials.lockoutTime}s`,
    );
  }

  const backendConfig = Deno.env.get("SB_SHELL_BACKEND") || "local";
  const enableSpaceScript = Deno.env.get("SB_SPACE_SCRIPT") !== "off";

  const spaceIgnore = Deno.env.get("SB_SPACE_IGNORE");

  const plugAssets = new AssetBundle(plugAssetBundle as AssetJson);

  const clientAssets = new AssetBundle(clientAssetBundle as AssetJson);
  const manifestName = Deno.env.get("SB_NAME");
  const manifestDescription = Deno.env.get("SB_DESCRIPTION");

  if (manifestName || manifestDescription || hostUrlPrefix) {
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
    clientAssets.writeTextFileSync(
      ".client/manifest.json",
      "application/json",
      JSON.stringify(manifestData),
    );
  }
  const httpServer = new HttpServer({
    hostname,
    port,
    clientAssetBundle: clientAssets,
    plugAssetBundle: plugAssets,
    baseKvPrimitives,
    keyFile: options.key,
    certFile: options.cert,
    indexPage,
    spaceIgnore,
    auth: userCredentials,
    readOnly,
    shellBackend: backendConfig,
    enableSpaceScript,
    pagesPath: folder,
    hostUrlPrefix,
  });
  await httpServer.start();

  // Wait in an infinite loop (to keep the HTTP server running, only cancelable via Ctrl+C or other signal)
  while (true) {
    await sleep(10000);
  }
}
