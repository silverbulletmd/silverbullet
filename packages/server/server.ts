#!/usr/bin/env node --enable-source-maps
import { nodeModulesDir } from "@plugos/plugos/environments/node_sandbox";
import { preloadModules } from "@silverbulletmd/common/preload_modules";
import { realpathSync } from "fs";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { ExpressServer } from "./express_server";

let args = yargs(hideBin(process.argv))
  .option("port", {
    type: "number",
    default: 3000,
  })
  .option("token", {
    type: "string",
  })
  .parse();

if (!args._.length) {
  console.error(
    "Usage: silverbullet [--port 3000] [--token mysecrettoken] <path-to-pages>"
  );
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

const expressServer = new ExpressServer({
  port: port,
  pagesPath: pagesPath,
  preloadedModules: preloadModules,
  distDir: webappDistDir,
  builtinPlugDir: plugDistDir,
  token: args.token,
});
expressServer.start().catch((e) => {
  console.error(e);
});
