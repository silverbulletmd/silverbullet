import cors from "cors";
import express from "express";
import fs from "fs";
import { readdir, readFile, stat, unlink } from "fs/promises";
import path from "path";
import stream from "stream";
import { promisify } from "util";

import { ChangeSet, Text } from "@codemirror/state";
import { Update } from "@codemirror/collab";
import http from "http";
import { Server } from "socket.io";
import { serverEvents } from "./events";

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
const pagesPath = "../pages";
const distDir = `${__dirname}/../../webapp/dist`;

type PageMeta = {
  name: string;
  lastModified: number;
};

class DiskFS {
  rootPath: string;

  constructor(rootPath: string) {
    this.rootPath = rootPath;
  }

  async listPages(): Promise<PageMeta[]> {
    let fileNames: PageMeta[] = [];

    let _this = this;

    async function walkPath(dir: string) {
      let files = await readdir(dir);
      for (let file of files) {
        const fullPath = path.join(dir, file);
        let s = await stat(fullPath);
        if (s.isDirectory()) {
          await walkPath(fullPath);
        } else {
          if (path.extname(file) === ".md") {
            fileNames.push({
              name: fullPath.substring(
                _this.rootPath.length + 1,
                fullPath.length - 3
              ),
              lastModified: s.mtime.getTime(),
            });
          }
        }
      }
    }
    await walkPath(this.rootPath);
    return fileNames;
  }

  async readPage(pageName: string): Promise<{ text: string; meta: PageMeta }> {
    const localPath = path.join(pagesPath, pageName + ".md");
    const s = await stat(localPath);
    return {
      text: await readFile(localPath, "utf8"),
      meta: {
        name: pageName,
        lastModified: s.mtime.getTime(),
      },
    };
  }

  async writePage(pageName: string, body: any): Promise<PageMeta> {
    let localPath = path.join(pagesPath, pageName + ".md");
    await pipeline(body, fs.createWriteStream(localPath));
    console.log(`Wrote to ${localPath}`);
    const s = await stat(localPath);
    return {
      name: pageName,
      lastModified: s.mtime.getTime(),
    };
  }

  async getPageMeta(pageName: string): Promise<PageMeta> {
    let localPath = path.join(pagesPath, pageName + ".md");
    const s = await stat(localPath);
    return {
      name: pageName,
      lastModified: s.mtime.getTime(),
    };
  }

  async deletePage(pageName: string) {
    let localPath = path.join(pagesPath, pageName + ".md");
    await unlink(localPath);
  }
}

app.use("/", express.static(distDir));

let fsRouter = express.Router();
let diskFS = new DiskFS(pagesPath);

// Page list
fsRouter.route("/").get(async (req, res) => {
  res.json(await diskFS.listPages());
});

fsRouter
  .route(/\/(.+)/)
  .get(async (req, res) => {
    let reqPath = req.params[0];
    console.log("Getting", reqPath);
    try {
      let { text, meta } = await diskFS.readPage(reqPath);
      res.status(200);
      res.header("Last-Modified", "" + meta.lastModified);
      res.header("Content-Type", "text/markdown");
      res.send(text);
    } catch (e) {
      res.status(200);
      res.send("");
    }
  })
  .put(async (req, res) => {
    let reqPath = req.params[0];

    try {
      let meta = await diskFS.writePage(reqPath, req);
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
      const meta = await diskFS.getPageMeta(reqPath);
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
      await diskFS.deletePage(reqPath);
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

import { Socket } from "socket.io";

class Page {
  text: Text;
  updates: Update[];
  sockets: Map<string, Socket>;

  constructor(text: string) {
    this.updates = [];
    this.text = Text.of([text]);
    this.sockets = new Map<string, Socket>();
  }
}

let openPages = new Map<string, Page>();

io.on("connection", (socket) => {
  function removeSocket(pageName: string) {
    let page = openPages.get(pageName);
    if (page) {
      page.sockets.delete(socket.id);
      if (page.sockets.size === 0) {
        console.log("No more sockets for", pageName, "flushing");
        openPages.delete(pageName);
      }
    }
  }

  console.log("Connected", socket.id);
  let socketOpenPages = new Set<string>();
  socket.on(serverEvents.openPage, async (pageName: string) => {
    let page = openPages.get(pageName);
    if (!page) {
      let { text } = await diskFS.readPage(pageName);
      page = new Page(text);
      openPages.set(pageName, page);
    }
    page.sockets.set(socket.id, socket);
    socketOpenPages.add(pageName);
    console.log("Sending document text");
    socket.emit(
      serverEvents.pageText,
      pageName,
      openPages.get(pageName).text.toJSON()
    );
  });
  socket.on(serverEvents.closePage, (pageName: string) => {
    console.log("Closing page", pageName);
    removeSocket(pageName);
    socketOpenPages.delete(pageName);
  });
  socket.on("disconnect", () => {
    console.log("Disconnected", socket.id);
    socketOpenPages.forEach(removeSocket);
  });
});
//sup
server.listen(port, () => {
  console.log(`Server istening on port ${port}`);
});
