import bodyParser from "body-parser";
import cors from "cors";
import express from "express";
import { readFile } from "fs/promises";
import http from "http";
import { Server } from "socket.io";
import stream from "stream";
import { promisify } from "util";
import { RealtimeStorage } from "./realtime_storage";

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    methods: "GET,HEAD,PUT,OPTIONS,POST,DELETE",
    preflightContinue: true,
  },
});

const port = 3000;
const pipeline = promisify(stream.pipeline);
export const pagesPath = "../pages";
const distDir = `${__dirname}/../../webapp/dist`;

export type PageMeta = {
  name: string;
  lastModified: number;
  version?: number;
};

app.use("/", express.static(distDir));

let fsRouter = express.Router();
// let diskFS = new DiskFS(pagesPath);
let filesystem = new RealtimeStorage(pagesPath, io);

// Page list
fsRouter.route("/").get(async (req, res) => {
  res.json(await filesystem.listPages());
});

fsRouter
  .route(/\/(.+)/)
  .get(async (req, res) => {
    let reqPath = req.params[0];
    console.log("Getting", reqPath);
    try {
      let { text, meta } = await filesystem.readPage(reqPath);
      res.status(200);
      res.header("Last-Modified", "" + meta.lastModified);
      res.header("Content-Type", "text/markdown");
      res.send(text);
    } catch (e) {
      res.status(200);
      res.send("");
    }
  })
  .put(bodyParser.text({ type: "*/*" }), async (req, res) => {
    let reqPath = req.params[0];

    try {
      let meta = await filesystem.writePage(reqPath, req.body);
      res.status(200);
      res.header("Last-Modified", "" + meta.lastModified);
      res.send("OK");
    } catch (err) {
      res.status(500);
      res.send("Write failed");
      console.error("Pipeline failed", err);
    }
  })
  .options(async (req, res) => {
    let reqPath = req.params[0];
    try {
      const meta = await filesystem.getPageMeta(reqPath);
      res.status(200);
      res.header("Last-Modified", "" + meta.lastModified);
      res.header("Content-Type", "text/markdown");
      res.send("");
    } catch (e) {
      res.status(200);
      res.send("");
    }
  })
  .delete(async (req, res) => {
    let reqPath = req.params[0];
    try {
      await filesystem.deletePage(reqPath);
      res.status(200);
      res.send("OK");
    } catch (e) {
      console.error("Error deleting file", reqPath, e);
      res.status(500);
      res.send("OK");
    }
  });

app.use(
  "/fs",
  cors({
    methods: "GET,HEAD,PUT,OPTIONS,POST,DELETE",
    preflightContinue: true,
  }),
  fsRouter
);

// Fallback, serve index.html
let cachedIndex: string | undefined = undefined;
app.get("/*", async (req, res) => {
  if (!cachedIndex) {
    cachedIndex = await readFile(`${distDir}/index.html`, "utf8");
  }
  res.status(200).header("Content-Type", "text/html").send(cachedIndex);
});

//sup
server.listen(port, () => {
  console.log(`Server istening on port ${port}`);
});
