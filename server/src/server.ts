import express from "express";
import { readFile } from "fs/promises";
import http from "http";
import { Server } from "socket.io";
import { SocketServer } from "./api";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

let args = yargs(hideBin(process.argv))
  .option("debug", {
    type: "boolean",
  })
  .option("port", {
    type: "number",
    default: 3000,
  })
  .parse();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    methods: "GET,HEAD,PUT,OPTIONS,POST,DELETE",
    preflightContinue: true,
  },
});

const port = args.port;
const distDir = `${__dirname}/../../webapp/dist`;

app.use("/", express.static(distDir));
let socketServer = new SocketServer(args._[0] as string, io);

// Fallback, serve index.html
let cachedIndex: string | undefined = undefined;
app.get("/*", async (req, res) => {
  if (!cachedIndex) {
    cachedIndex = await readFile(`${distDir}/index.html`, "utf8");
  }
  res.status(200).header("Content-Type", "text/html").send(cachedIndex);
});

server.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
