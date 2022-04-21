#!/usr/bin/env node

import express from "express";
import http from "http";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { SilverBulletHooks } from "@silverbulletmd/common/manifest";
import { ExpressServer } from "./api_server";
import { System } from "@silverbulletmd/plugos/system";
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

const app = express();
const server = http.createServer(app);
const system = new System<SilverBulletHooks>("server");

const port = args.port;
const distDir = path.resolve(`${__dirname}/../../silverbullet-web/dist`);

app.use("/", express.static(distDir));

const expressServer = new ExpressServer(app, pagesPath, distDir, system);
expressServer
  .init()
  .then(async () => {
    server.listen(port, () => {
      console.log(`Server listening on port ${port}`);
    });
  })
  .catch((e) => {
    console.error(e);
  });
