#!/usr/bin/env node

import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { ExpressServer } from "./api_server";
import path from "path";

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
const distDir = path.resolve(`${__dirname}/../../silverbullet-web/dist`);

const expressServer = new ExpressServer(port, pagesPath, distDir);
expressServer.start().catch((e) => {
  console.error(e);
});
