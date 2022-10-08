#!/usr/bin/env -S node --enable-source-maps
import * as flags from "https://deno.land/std@0.158.0/flags/mod.ts";
import * as path from "https://deno.land/std@0.158.0/path/mod.ts";
import { ExpressServer } from "./express_server.ts";

const args = flags.parse(Deno.args, {
  string: ["port", "password", "builtins"],
  alias: { p: "port" },
  default: {
    port: "3000",
  },
});

if (!args._.length) {
  console.error(
    "Usage: silverbullet [--port 3000] [--password mysecretpassword] <path-to-pages>",
  );
  Deno.exit(1);
}

const pagesPath = path.resolve(Deno.cwd(), args._[0] as string);
const port = +args.port;

import assetBundle from "../dist/web_bundle.json" assert { type: "json" };

console.log("Pages dir", pagesPath);

const expressServer = new ExpressServer({
  port: port,
  pagesPath: pagesPath,
  assetBundle: assetBundle,
  password: args.password,
});
expressServer.start().catch((e) => {
  console.error(e);
});
