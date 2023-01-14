import type { ForgeConfig } from "@electron-forge/shared-types";
import type { TargetArch } from "electron-packager";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerRpm } from "@electron-forge/maker-rpm";
import { WebpackPlugin } from "@electron-forge/plugin-webpack";

import { mainConfig } from "./webpack.main.config";
import { rendererConfig } from "./webpack.renderer.config";
import { platform } from "node:os";

import fs from "node:fs";
import path from "node:path";
import decompress from "decompress";
import { downloadFile } from "./http_util";

const denoVersion = "v1.29.1";

const denoZip: Record<string, string> = {
  "win32-x64": "deno-x86_64-pc-windows-msvc.zip",
  "darwin-x64": "deno-x86_64-apple-darwin.zip",
  "darwin-arm64": "deno-aarch64-apple-darwin.zip",
  "linux-x64": "deno-x86_64-unknown-linux-gnu.zip",
};

const denoExecutableResource = platform() === "win32"
  ? "resources/deno.exe"
  : "resources/deno";

async function downloadDeno(platform: string, arch: string): Promise<void> {
  const folder = fs.mkdtempSync("deno-download");
  const destFile = path.join(folder, "deno.zip");
  const zipFile = denoZip[`${platform}-${arch}`];
  if (!zipFile) {
    throw new Error(`No deno binary for ${platform}-${arch}`);
  }
  await downloadFile(
    `https://github.com/denoland/deno/releases/download/${denoVersion}/${zipFile}`,
    destFile,
  );
  await decompress(destFile, "resources");
  fs.rmSync(folder, { recursive: true });
}

const config: ForgeConfig = {
  packagerConfig: {
    name: process.platform === "linux" ? "silverbullet" : "SilverBullet",
    executableName: process.platform === "linux"
      ? "silverbullet"
      : "SilverBullet",
    icon: "../web/images/logo",
    appBundleId: "md.silverbullet",
    extraResource: [denoExecutableResource, "resources/silverbullet.js", "resources/logo.png"],
    beforeCopyExtraResources: [(
      _buildPath: string,
      _electronVersion: string,
      platform: TargetArch,
      arch: TargetArch,
      callback: (err?: Error | null) => void,
    ) => {
      if (fs.existsSync(denoExecutableResource)) {
        fs.rmSync(denoExecutableResource, { force: true });
      }
      Promise.resolve().then(async () => {
        // Download deno
        await downloadDeno(platform, arch);
        // Copy silverbullet.js
        fs.copyFileSync("../dist/silverbullet.js", "resources/silverbullet.js");
        fs.copyFileSync("../web/images/logo.png", "resources/logo.png");
      }).then((r) => callback()).catch(callback);
    }],
    osxSign: {
      optionsForFile: (filePath: string) => {
        // So these entitlements somehow only seem to be needed for the Intel macOS build
        // Why? No idea. But it works.
        return {
          entitlements: "entitlements.plist",
        };
      },
    },
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({
      iconUrl: "https://silverbullet.md/icon.ico",
      setupIcon: "../web/images/icon.ico"
    }),
    new MakerZIP({}, ["darwin", "linux"]),
    new MakerRpm({}),
    new MakerDeb({
      options: {
        icon: "../web/images/logo.png"
      }
    }),
  ],

  plugins: [
    new WebpackPlugin({
      port: 3001,
      mainConfig,
      renderer: {
        config: rendererConfig,

        entryPoints: [
          {
            // html: "./src/index.html",
            // js: "./src/renderer.ts",
            name: "main_window",
            preload: {
              js: "./src/preload.ts",
            },
          },
        ],
      },
    }),
  ],
};

function notarizeMaybe() {
  if (process.platform !== "darwin") {
    return;
  }

  if (!process.env.CI) {
    return;
  }

  if (!process.env.APPLE_ID || !process.env.APPLE_ID_PASSWORD) {
    console.warn(
      "Should be notarizing, but environment variables APPLE_ID or APPLE_ID_PASSWORD are missing!",
    );
    return;
  }

  config.packagerConfig!.osxNotarize = {
    appleId: process.env.APPLE_ID!,
    appleIdPassword: process.env.APPLE_ID_PASSWORD!,
    teamId: process.env.APPLE_TEAM_ID!,
  };
}

notarizeMaybe();

export default config;
