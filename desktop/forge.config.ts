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

import axios from "axios";
import fs from "node:fs";
import path from "node:path";
import decompress from "decompress";

const denoVersion = "v1.29.1";

const denoZip: Record<string, string> = {
  "win32-x64": "deno-x86_64-pc-windows-msvc.zip",
  "darwin-x64": "deno-x86_64-apple-darwin.zip",
  "darwin-arm64": "deno-aarch64-apple-darwin.zip",
  "linux-x64": "deno-x86_64-unknown-linux-gnu.zip",
};

const denoExec = platform() === "win32"
  ? "resources/deno.exe"
  : "resources/deno";

async function downloadDeno(): Promise<void> {
  const folder = fs.mkdtempSync("deno-download");
  const destFile = path.join(folder, "deno.zip");
  const file = fs.createWriteStream(destFile);
  const zipFile = denoZip[`${platform()}-${process.arch}`];
  if (!zipFile) {
    throw new Error(`No deno binary for ${platform()}-${process.arch}`);
  }
  let response = await axios.request({
    url:
      `https://github.com/denoland/deno/releases/download/${denoVersion}/${zipFile}`,
    method: "GET",
    responseType: "stream",
  });
  return new Promise((resolve, reject) => {
    response.data.pipe(file);
    let error: Error | null = null;
    // after download completed close filestream
    file.on("error", (e) => {
      error = e;
      reject(e);
    });
    file.on("close", () => {
      if (error) {
        return;
      }
      file.close();
      console.log("Download Completed");
      decompress(destFile, "resources").then((files) => {
        resolve();
      });
    });
  });
}

const config: ForgeConfig = {
  packagerConfig: {
    icon: "../web/images/logo",
    extraResource: [denoExec],
    beforeCopyExtraResources: [(
      buildPath: string,
      electronVersion: string,
      platform: TargetArch,
      arch: TargetArch,
      callback: (err?: Error | null) => void,
    ) => {
      if (
        !fs.existsSync(denoExec)
      ) {
        downloadDeno().then((r) => callback()).catch(callback);
      } else {
        callback();
      }
    }],
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({}),
    new MakerZIP({}, ["darwin"]),
    new MakerRpm({}),
    new MakerDeb({}),
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

export default config;
