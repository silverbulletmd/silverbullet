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

const silverbulletServerExecutable = platform() === "win32"
  ? "silverbullet.exe"
  : "silverbullet";

const config: ForgeConfig = {
  packagerConfig: {
    name: process.platform === "linux" ? "silverbullet" : "SilverBullet",
    executableName: process.platform === "linux"
      ? "silverbullet"
      : "SilverBullet",
    icon: "../web/images/logo",
    appBundleId: "md.silverbullet",
    extraResource: [`resources/${silverbulletServerExecutable}`, "resources/logo.png"],
    beforeCopyExtraResources: [(
      _buildPath: string,
      _electronVersion: string,
      platform: TargetArch,
      arch: TargetArch,
      callback: (err?: Error | null) => void,
    ) => {
      Promise.resolve().then(async () => {
        // Copy silverbullet server executable
        fs.mkdirSync("resources", {recursive: true});
        fs.copyFileSync("../web/images/logo.png", "resources/logo.png");
        fs.copyFileSync(`../bin/${silverbulletServerExecutable}`, `resources/${silverbulletServerExecutable}`);
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
      iconUrl: "https://silverbullet.md/logo.ico",
      setupIcon: "../web/images/logo.ico"
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
