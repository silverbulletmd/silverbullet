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
import { ClientPageState, Page } from "./types";
import { safeRun } from "./util";

export function exposeSocketAPI(rootPath: string, io: Server) {
  const openPages = new Map<string, Page>();
  const connectedSockets: Set<Socket> = new Set();
  const pageStore = new DiskStorage(rootPath);
  fileWatcher(rootPath);

  io.on("connection", (socket) => {
    const socketOpenPages = new Set<string>();

    console.log("Connected", socket.id);
    connectedSockets.add(socket);

    socket.on("disconnect", () => {
      console.log("Disconnected", socket.id);
      socketOpenPages.forEach(disconnectPageSocket);
      connectedSockets.delete(socket);
    });

    socket.on("closePage", (pageName: string) => {
      console.log("Closing page", pageName);
      socketOpenPages.delete(pageName);
      disconnectPageSocket(pageName);
    });

    const onCall = (
      eventName: string,
      cb: (...args: any[]) => Promise<any>
    ) => {
      socket.on(eventName, (reqId: number, ...args) => {
        cb(...args).then((result) => {
          socket.emit(`${eventName}Resp${reqId}`, result);
        });
      });
    };

    const disconnectPageSocket = (pageName: string) => {
      let page = openPages.get(pageName);
      if (page) {
        for (let client of page.clientStates) {
          if (client.socket === socket) {
            disconnectClient(client, page);
          }
        }
      }
    };

    onCall("openPage", async (pageName: string) => {
      let page = openPages.get(pageName);
      if (!page) {
        try {
          let { text, meta } = await pageStore.readPage(pageName);
          page = new Page(pageName, text, meta);
        } catch (e) {
          console.log("Creating new page", pageName);
          page = new Page(pageName, "", { name: pageName, lastModified: 0 });
        }
        openPages.set(pageName, page);
      }
      page.clientStates.add(new ClientPageState(socket, page.version));
      socketOpenPages.add(pageName);
      console.log("Opened page", pageName);
      broadcastCursors(page);
      return page.toJSON();
    });

    onCall(
      "pushUpdates",
      async (
        pageName: string,
        version: number,
        updates: any[]
      ): Promise<boolean> => {
        let page = openPages.get(pageName);

        if (!page) {
          console.error(
            "Received updates for not open page",
            pageName,
            openPages.keys()
          );
          return false;
        }
        if (version !== page.version) {
          console.error("Invalid version", version, page.version);
          return false;
        } else {
          console.log("Applying", updates.length, "updates to", pageName);
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
              flushPageToDisk(pageName, page);
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
        let page = openPages.get(pageName);
        // console.log("Pulling updates for", pageName);
        if (!page) {
          console.error("Fetching updates for not open page");
          return [];
        }
        // TODO: Optimize this
        let oldestVersion = Infinity;
        page.clientStates.forEach((client) => {
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

    onCall(
      "readPage",
      async (pageName: string): Promise<{ text: string; meta: PageMeta }> => {
        let page = openPages.get(pageName);
        if (page) {
          console.log("Serving page from memory", pageName);
          return {
            text: page.text.sliceString(0),
            meta: page.meta,
          };
        } else {
          return pageStore.readPage(pageName);
        }
      }
    );

    onCall("writePage", async (pageName: string, text: string) => {
      let page = openPages.get(pageName);
      if (page) {
        for (let client of page.clientStates) {
          client.socket.emit("reloadPage", pageName);
        }
        openPages.delete(pageName);
      }
      return pageStore.writePage(pageName, text);
    });

    onCall("deletePage", async (pageName: string) => {
      openPages.delete(pageName);
      socketOpenPages.delete(pageName);
      // Cascading of this to all connected clients will be handled by file watcher
      return pageStore.deletePage(pageName);
    });

    onCall("listPages", async (): Promise<PageMeta[]> => {
      return pageStore.listPages();
    });

    onCall("getPageMeta", async (pageName: string): Promise<PageMeta> => {
      let page = openPages.get(pageName);
      if (page) {
        return page.meta;
      }
      return pageStore.getPageMeta(pageName);
    });
  });

  function disconnectClient(client: ClientPageState, page: Page) {
    page.clientStates.delete(client);
    if (page.clientStates.size === 0) {
      console.log("No more clients for", page.name, "flushing");
      flushPageToDisk(page.name, page);
      openPages.delete(page.name);
    } else {
      page.cursors.delete(client.socket.id);
      broadcastCursors(page);
    }
  }

  function broadcastCursors(page: Page) {
    page.clientStates.forEach((client) => {
      client.socket.emit(
        "cursorSnapshot",
        page.name,
        Object.fromEntries(page.cursors.entries())
      );
    });
  }

  function flushPageToDisk(name: string, page: Page) {
    safeRun(async () => {
      let meta = await pageStore.writePage(name, page.text.sliceString(0));
      console.log(`Wrote page ${name} to disk`);
      page.meta = meta;
    });
  }

  function fileWatcher(rootPath: string) {
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
          // console.log("Edit in", pageName, eventType);
          let modifiedTime = 0;
          try {
            let s = await stat(localPath);
            modifiedTime = s.mtime.getTime();
          } catch (e) {
            // File was deleted
            console.log("Deleted", pageName);
            for (let socket of connectedSockets) {
              socket.emit("pageDeleted", pageName);
            }
            return;
          }
          const openPage = openPages.get(pageName);
          if (openPage) {
            if (openPage.meta.lastModified < modifiedTime) {
              console.log("Page changed on disk outside of editor, reloading");
              openPages.delete(pageName);
              const meta = {
                name: pageName,
                lastModified: modifiedTime,
              } as PageMeta;
              for (let client of openPage.clientStates) {
                client.socket.emit("pageChanged", meta);
              }
            }
          }
          if (eventType === "rename") {
            // This most likely means a new file was created, let's push new file listings to all connected sockets
            console.log(
              "New file created, broadcasting to all connected sockets"
            );
            for (let socket of connectedSockets) {
              socket.emit("pageCreated", {
                name: pageName,
                lastModified: modifiedTime,
              } as PageMeta);
            }
          }
        });
      }
    );
  }
}
