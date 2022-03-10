import fs from "fs";
import { stat } from "fs/promises";
import path from "path";
import { ChangeSet } from "@codemirror/state";
import { Update } from "@codemirror/collab";
import { Server } from "socket.io";
import { Cursor, cursorEffect } from "../../webapp/src/cursorEffect";
import { Socket } from "socket.io";
import { DiskStorage } from "./disk_storage";
import { PageMeta } from "./server";
import { Client, Page } from "./types";
import { safeRun } from "./util";

export class RealtimeStorage extends DiskStorage {
  openPages = new Map<string, Page>();

  private disconnectClient(client: Client, page: Page) {
    page.clients.delete(client);
    if (page.clients.size === 0) {
      console.log("No more clients for", page.name, "flushing");
      this.flushPageToDisk(page.name, page);
      this.openPages.delete(page.name);
    } else {
      page.cursors.delete(client.socket.id);
      this.broadcastCursors(page);
    }
  }

  private broadcastCursors(page: Page) {
    page.clients.forEach((client) => {
      client.socket.emit("cursors", Object.fromEntries(page.cursors.entries()));
    });
  }

  private flushPageToDisk(name: string, page: Page) {
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

  async writePage(pageName: string, text: string): Promise<PageMeta> {
    let page = this.openPages.get(pageName);
    if (page) {
      for (let client of page.clients) {
        client.socket.emit("reload", pageName);
      }
      this.openPages.delete(pageName);
    }
    return super.writePage(pageName, text);
  }

  disconnectPageSocket(socket: Socket, pageName: string) {
    let page = this.openPages.get(pageName);
    if (page) {
      for (let client of page.clients) {
        if (client.socket === socket) {
          this.disconnectClient(client, page);
        }
      }
    }
  }

  constructor(rootPath: string, io: Server) {
    super(rootPath);

    // setInterval(() => {
    //   console.log("Currently open pages:", this.openPages.keys());
    // }, 10000);

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
              this.openPages.delete(pageName);
              for (let client of openPage.clients) {
                client.socket.emit("reload", pageName);
              }
            }
          }
        });
      }
    );

    io.on("connection", (socket) => {
      console.log("Connected", socket.id);
      let clientOpenPages = new Set<string>();

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
            page = new Page(pageName, text, meta);
          } catch (e) {
            console.log("Creating new page", pageName);
            page = new Page(pageName, "", { name: pageName, lastModified: 0 });
          }
          this.openPages.set(pageName, page);
        }
        page.clients.add(new Client(socket, page.version));
        clientOpenPages.add(pageName);
        console.log("Opened page", pageName);
        this.broadcastCursors(page);
        return page.toJSON();
      });

      socket.on("closePage", (pageName: string) => {
        console.log("Closing page", pageName);
        clientOpenPages.delete(pageName);
        this.disconnectPageSocket(socket, pageName);
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
          if (version !== page.version) {
            console.error("Invalid version", version, page.version);
            return false;
          } else {
            console.log("Applying", updates.length, "updates");
            let transformedUpdates = [];
            let textChanged = false;
            for (let update of updates) {
              let changes = ChangeSet.fromJSON(update.changes);
              let transformedUpdate = {
                changes,
                clientID: update.clientID,
                effects: update.cursors?.map((c: Cursor) => {
                  page.cursors.set(c.userId, c);
                  return cursorEffect.of(c);
                }),
              };
              page.updates.push(transformedUpdate);
              transformedUpdates.push(transformedUpdate);
              let oldText = page.text;
              page.text = changes.apply(page.text);
              if (oldText !== page.text) {
                textChanged = true;
              }
            }

            if (textChanged) {
              if (page.saveTimer) {
                clearTimeout(page.saveTimer);
              }

              page.saveTimer = setTimeout(() => {
                this.flushPageToDisk(pageName, page);
              }, 1000);
            }
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
          // TODO: Optimize this
          let oldestVersion = Infinity;
          page.clients.forEach((client) => {
            oldestVersion = Math.min(client.version, oldestVersion);
            if (client.socket === socket) {
              client.version = version;
            }
          });
          page.flushUpdates(oldestVersion);
          if (version < page.version) {
            return page.updatesSince(version);
          } else {
            return new Promise((resolve) => {
              page.pending.push(resolve);
            });
          }
        }
      );

      socket.on("disconnect", () => {
        console.log("Disconnected", socket.id);
        clientOpenPages.forEach((pageName) => {
          this.disconnectPageSocket(socket, pageName);
        });
      });
    });
  }
}
