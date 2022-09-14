// #!/usr/bin/env -S node --enable-source-maps
import { nodeModulesDir } from "@plugos/plugos/environments/node_sandbox";
import { realpathSync } from "fs";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { ExpressServer } from "./express_server";

let args = yargs(hideBin(process.argv))
  .option("port", {
    type: "number",
    default: 3000,
  })
  .option("password", {
    type: "string",
  })
  .parse();

if (!args._.length) {
  console.error(
    "Usage: silverbullet [--port 3000] [--password mysecretpassword] <path-to-pages>"
  );
  process.exit(1);
}

const pagesPath = args._[0] as string;
const port = args.port;

const webappDistDir = realpathSync(
  `${nodeModulesDir}/node_modules/@silverbulletmd/web/dist`
);
// console.log("Webapp dist dir", webappDistDir);
const plugDistDir = realpathSync(
  `${nodeModulesDir}/node_modules/@silverbulletmd/plugs/dist`
);
// console.log("Builtin plug dist dir", plugDistDir);

const expressServer = new ExpressServer({
  port: port,
  pagesPath: pagesPath,
  distDir: webappDistDir,
  builtinPlugDir: plugDistDir,
  password: args.password,
});
expressServer.start().catch((e) => {
  console.error(e);
});
