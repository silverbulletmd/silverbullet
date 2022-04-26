#!/usr/bin/env node

import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { ExpressServer } from "./api_server";
import { nodeModulesDir } from "@plugos/plugos/environments/node_sandbox";
import { preloadModules } from "@silverbulletmd/common/preload_modules";
import path from "path";
import { realpath } from "fs/promises";
import { realpathSync } from "fs";

let args = yargs(hideBin(process.argv))
  .option("port", {
    type: "number",
    default: 3000,
  })
  .parse();

if (!args._.length) {
  console.error("Usage: silverbullet <path-to-pages>");
  process.exit(1);
}

const pagesPath = args._[0] as string;
const port = args.port;

const webappDistDir = realpathSync(
  `${nodeModulesDir}/node_modules/@silverbulletmd/web/dist`
);
console.log("Webapp dist dir", webappDistDir);
const plugDistDir = realpathSync(
  `${nodeModulesDir}/node_modules/@silverbulletmd/plugs/dist`
);
console.log("Builtin plug dist dir", plugDistDir);

const expressServer = new ExpressServer(
  port,
  pagesPath,
  webappDistDir,
  plugDistDir,
  preloadModules
);
expressServer.start().catch((e) => {
  console.error(e);
});
