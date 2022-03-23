import express from "express";
import http from "http";
import { Server } from "socket.io";
import { SocketServer } from "./api_server";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { SilverBulletHooks } from "../common/manifest";
import { ExpressServer } from "./express_server";
import { DiskPlugLoader } from "../plugbox/plug_loader";
import { NodeCronFeature } from "../plugbox/feature/node_cron";
import shellSyscalls from "./syscalls/shell";
import { System } from "../plugbox/system";

let args = yargs(hideBin(process.argv))
  .option("debug", {
    type: "boolean",
  })
  .option("port", {
    type: "number",
    default: 3000,
  })
  .parse();

const pagesPath = args._[0] as string;

const app = express();
const server = http.createServer(app);
const system = new System<SilverBulletHooks>("server");

const io = new Server(server, {
  cors: {
    methods: "GET,HEAD,PUT,OPTIONS,POST,DELETE",
    preflightContinue: true,
  },
});

const port = args.port;
const distDir = `${__dirname}/../webapp`;

app.use("/", express.static(distDir));

let socketServer = new SocketServer(pagesPath, io, system);
socketServer.init().catch((e) => {
  console.error(e);
});

const expressServer = new ExpressServer(app, pagesPath, distDir, system);
expressServer
  .init()
  .then(async () => {
    let plugLoader = new DiskPlugLoader(
      system,
      `${__dirname}/../../plugs/dist`
    );
    await plugLoader.loadPlugs();
    plugLoader.watcher();
    system.registerSyscalls(shellSyscalls(pagesPath));
    system.addFeature(new NodeCronFeature());
    server.listen(port, () => {
      console.log(`Server listening on port ${port}`);
    });
  })
  .catch((e) => {
    console.error(e);
  });
