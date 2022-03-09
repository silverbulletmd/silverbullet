import cors from "cors";
import express, { text } from "express";
import fs from "fs";
import { readdir, readFile, stat, unlink } from "fs/promises";
import path from "path";
import stream from "stream";
import { promisify } from "util";
import { debounce } from "lodash";

import { ChangeSet, Text } from "@codemirror/state";
import { Update } from "@codemirror/collab";
import http from "http";
import { Server } from "socket.io";

import { cursorEffect } from "../../webapp/src/cursorEffect";

function safeRun(fn: () => Promise<void>) {
  fn().catch((e) => {
    console.error(e);
  });
}

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
  version?: number;
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
    // console.log(`Wrote to ${localPath}`);
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

import { Socket } from "socket.io";

class Page {
  text: Text;
  updates: Update[];
  sockets: Set<Socket>;
  meta: PageMeta;

  pending: ((value: any) => void)[] = [];

  saveTimer: NodeJS.Timeout | undefined;

  constructor(text: string, meta: PageMeta) {
    this.updates = [];
    this.text = Text.of(text.split("\n"));
    this.meta = meta;
    this.sockets = new Set<Socket>();
  }
}

class RealtimeEditFS extends DiskFS {
  openPages = new Map<string, Page>();

  disconnectSocket(socket: Socket, pageName: string) {
    let page = this.openPages.get(pageName);
    if (page) {
      page.sockets.delete(socket);
      if (page.sockets.size === 0) {
        console.log("No more sockets for", pageName, "flushing");
        this.flushPageToDisk(pageName, page);
        this.openPages.delete(pageName);
      }
    }
  }

  flushPageToDisk(name: string, page: Page) {
    super
      .writePage(name, page.text.sliceString(0))
      .then((meta) => {
        console.log(`Wrote page ${name} to disk`);
        page.meta = meta;
      })
      .catch((e) => {
        console.log(`Could not write ${name} to disk:`, e);
      });
  }

  // Override
  async readPage(pageName: string): Promise<{ text: string; meta: PageMeta }> {
    let page = this.openPages.get(pageName);
    if (page) {
      console.log("Serving page from memory", pageName);
      return {
        text: page.text.sliceString(0),
        meta: page.meta,
      };
    } else {
      return super.readPage(pageName);
    }
  }

  async writePage(pageName: string, body: any): Promise<PageMeta> {
    let page = this.openPages.get(pageName);
    if (page) {
      for (let socket of page.sockets) {
        socket.emit("reload", pageName);
      }
      this.openPages.delete(pageName);
    }
    return super.writePage(pageName, body);
  }

  constructor(rootPath: string, io: Server) {
    super(rootPath);

    setInterval(() => {
      console.log("Currently open pages:", this.openPages.keys());
    }, 10000);

    // Disk watcher
    fs.watch(
      rootPath,
      {
        recursive: true,
        persistent: false,
      },
      (eventType, filename) => {
        safeRun(async () => {
          if (path.extname(filename) !== ".md") {
            return;
          }
          let localPath = path.join(rootPath, filename);
          let pageName = filename.substring(0, filename.length - 3);
          let s = await stat(localPath);
          // console.log("Edit in", pageName);
          const openPage = this.openPages.get(pageName);
          if (openPage) {
            if (openPage.meta.lastModified < s.mtime.getTime()) {
              console.log("Page changed on disk outside of editor, reloading");
              for (let socket of openPage.sockets) {
                socket.emit("reload", pageName);
              }
              this.openPages.delete(pageName);
            }
          }
        });
      }
    );

    io.on("connection", (socket) => {
      console.log("Connected", socket.id);
      let socketOpenPages = new Set<string>();

      function onCall(eventName: string, cb: (...args: any[]) => Promise<any>) {
        socket.on(eventName, (reqId: number, ...args) => {
          cb(...args).then((result) => {
            socket.emit(`${eventName}Resp${reqId}`, result);
          });
        });
      }

      onCall("openPage", async (pageName: string) => {
        let page = this.openPages.get(pageName);
        if (!page) {
          try {
            let { text, meta } = await super.readPage(pageName);
            page = new Page(text, meta);
          } catch (e) {
            // console.log(`Could not open ${pageName}:`, e);
            // Page does not exist, let's create a new one
            console.log("Creating new page", pageName);
            page = new Page("", { name: pageName, lastModified: 0 });
          }
          this.openPages.set(pageName, page);
        }
        page.sockets.add(socket);
        socketOpenPages.add(pageName);
        console.log("Opened page", pageName);
        return [page.updates.length, page.text.toJSON()];
      });

      socket.on("closePage", (pageName: string) => {
        console.log("Closing page", pageName);
        this.disconnectSocket(socket, pageName);
        socketOpenPages.delete(pageName);
      });

      onCall(
        "pushUpdates",
        async (
          pageName: string,
          version: number,
          updates: any[]
        ): Promise<boolean> => {
          let page = this.openPages.get(pageName);

          if (!page) {
            console.error(
              "Received updates for not open page",
              pageName,
              this.openPages.keys()
            );
            return;
          }
          if (version !== page.updates.length) {
            console.error("Invalid version", version, page.updates.length);
            return false;
          } else {
            console.log("Applying", updates.length, "updates");
            let transformedUpdates = [];
            for (let update of updates) {
              let changes = ChangeSet.fromJSON(update.changes);
              console.log("Got effect", update);
              let transformedUpdate = {
                changes,
                clientID: update.clientID,
                effects: update.cursors?.map((c) => {
                  return cursorEffect.of(c);
                }),
              };
              page.updates.push(transformedUpdate);
              transformedUpdates.push(transformedUpdate);
              // TODO: save cursors locally as well
              page.text = changes.apply(page.text);
            }

            if (page.saveTimer) {
              clearTimeout(page.saveTimer);
            }

            page.saveTimer = setTimeout(() => {
              this.flushPageToDisk(pageName, page);
            }, 1000);
            while (page.pending.length) {
              page.pending.pop()!(transformedUpdates);
            }
            return true;
          }
        }
      );

      onCall(
        "pullUpdates",
        async (pageName: string, version: number): Promise<Update[]> => {
          let page = this.openPages.get(pageName);
          // console.log("Pulling updates for", pageName);
          if (!page) {
            console.error("Fetching updates for not open page");
            return [];
          }
          if (version < page.updates.length) {
            return page.updates.slice(version);
          } else {
            return new Promise((resolve) => {
              page.pending.push(resolve);
            });
          }
        }
      );

      socket.on("disconnect", () => {
        console.log("Disconnected", socket.id);
        socketOpenPages.forEach((page) => {
          this.disconnectSocket(socket, page);
        });
      });
    });
  }
}

app.use("/", express.static(distDir));

let fsRouter = express.Router();
// let diskFS = new DiskFS(pagesPath);
let filesystem = new RealtimeEditFS(pagesPath, io);

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
  .put(async (req, res) => {
    let reqPath = req.params[0];

    try {
      let meta = await filesystem.writePage(reqPath, req);
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
