import express from "express";
import { readFile } from "fs/promises";
import http from "http";
import { Server } from "socket.io";
import { SocketAPI } from "./api";

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    methods: "GET,HEAD,PUT,OPTIONS,POST,DELETE",
    preflightContinue: true,
  },
});

const port = 3000;
export const pagesPath = "../pages";
const distDir = `${__dirname}/../../webapp/dist`;

export type PageMeta = {
  name: string;
  lastModified: number;
  version?: number;
};

app.use("/", express.static(distDir));
let filesystem = new SocketAPI(pagesPath, io);

// Fallback, serve index.html
let cachedIndex: string | undefined = undefined;
app.get("/*", async (req, res) => {
  if (!cachedIndex) {
    cachedIndex = await readFile(`${distDir}/index.html`, "utf8");
  }
  res.status(200).header("Content-Type", "text/html").send(cachedIndex);
});

server.listen(port, () => {
  console.log(`Server istening on port ${port}`);
});
