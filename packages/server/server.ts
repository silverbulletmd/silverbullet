#!/usr/bin/env -S node --enable-source-maps
import * as flags from "https://deno.land/std@0.158.0/flags/mod.ts";
import * as path from "https://deno.land/std@0.158.0/path/mod.ts";
import { ExpressServer } from "./express_server.ts";

type ServerArgs = {
  _: string[];
  port: number;
  password: string;
};
let args: ServerArgs = flags.parse(Deno.args);

if (!args._.length) {
  console.error(
    "Usage: silverbullet [--port 3000] [--password mysecretpassword] <path-to-pages>",
  );
  Deno.exit(1);
}

const pagesPath = path.resolve(Deno.cwd(), args._[0] as string);
const port = args.port ? +args.port : 3000;

const webappDistDir = new URL("./../../dist", import.meta.url).pathname;
console.log("Webapp dist dir", webappDistDir);
const plugDistDir = new URL("./../plugs/dist", import.meta.url).pathname;
console.log("Pages dir", pagesPath);

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
