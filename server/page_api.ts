import { ClientPageState, Page, PageMeta } from "./types";
import { ChangeSet } from "@codemirror/state";
import { Update } from "@codemirror/collab";
import { ApiProvider, ClientConnection } from "./api_server";
import { Socket } from "socket.io";
import { DiskStorage } from "./disk_storage";
import { safeRun } from "./util";
import fs from "fs";
import path from "path";
import { stat } from "fs/promises";
import { Cursor, cursorEffect } from "../webapp/cursorEffect";
import { SilverBulletHooks } from "../common/manifest";
import { System } from "../plugos/system";
import { EventFeature } from "../plugos/feature/event";

export class PageApi implements ApiProvider {
  openPages: Map<string, Page>;
  pageStore: DiskStorage;
  rootPath: string;
  connectedSockets: Set<Socket>;
  private system: System<SilverBulletHooks>;
  private eventFeature: EventFeature;

  constructor(
    rootPath: string,
    connectedSockets: Set<Socket>,
    openPages: Map<string, Page>,
    system: System<SilverBulletHooks>
  ) {
    this.pageStore = new DiskStorage(rootPath);
    this.rootPath = rootPath;
    this.openPages = openPages;
    this.connectedSockets = connectedSockets;
    this.system = system;
    this.eventFeature = new EventFeature();
    system.addFeature(this.eventFeature);
  }

  async init(): Promise<void> {
    this.fileWatcher();
    // TODO: Move this elsewhere, this doesn't belong here
    this.system.on({
      plugLoaded: (plugName, plugDef) => {
        console.log("Plug updated on disk, broadcasting to all clients");
        this.connectedSockets.forEach((socket) => {
          socket.emit("plugLoaded", plugName, plugDef.manifest);
        });
      },
      plugUnloaded: (plugName) => {
        console.log("Plug removed on disk, broadcasting to all clients");
        this.connectedSockets.forEach((socket) => {
          socket.emit("plugUnloaded", plugName);
        });
      },
    });
  }

  broadcastCursors(page: Page) {
    page.clientStates.forEach((client) => {
      client.socket.emit(
        "cursorSnapshot",
        page.name,
        Object.fromEntries(page.cursors.entries())
      );
    });
  }

  async flushPageToDisk(name: string, page: Page) {
    let meta = await this.pageStore.writePage(name, page.text.sliceString(0));
    console.log(`Wrote page ${name} to disk`);
    page.meta = meta;
  }

  async disconnectClient(client: ClientPageState, page: Page) {
    console.log("Disconnecting client");
    page.clientStates.delete(client);
    if (page.clientStates.size === 0) {
      console.log("No more clients for", page.name, "flushing");
      await this.flushPageToDisk(page.name, page);
      this.openPages.delete(page.name);
    } else {
      page.cursors.delete(client.socket.id);
      this.broadcastCursors(page);
    }
  }

  fileWatcher() {
    fs.watch(
      this.rootPath,
      {
        recursive: true,
        persistent: false,
      },
      (eventType, filename) => {
        safeRun(async () => {
          if (!filename.endsWith(".md")) {
            return;
          }
          let localPath = path.join(this.rootPath, filename);
          let pageName = filename.substring(0, filename.length - 3);
          // console.log("Edit in", pageName, eventType);
          let modifiedTime = 0;
          try {
            let s = await stat(localPath);
            modifiedTime = s.mtime.getTime();
          } catch (e) {
            // File was deleted
            console.log("Deleted", pageName);
            for (let socket of this.connectedSockets) {
              socket.emit("pageDeleted", pageName);
            }
            return;
          }
          const openPage = this.openPages.get(pageName);
          if (openPage) {
            if (openPage.meta.lastModified < modifiedTime) {
              console.log("Page changed on disk outside of editor, reloading");
              this.openPages.delete(pageName);
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
              "New file created, broadcasting to all connected sockets",
              pageName
            );
            for (let socket of this.connectedSockets) {
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

  api() {
    return {
      openPage: async (clientConn: ClientConnection, pageName: string) => {
        let page = this.openPages.get(pageName);
        if (!page) {
          try {
            let { text, meta } = await this.pageStore.readPage(pageName);
            page = new Page(pageName, text, meta);
          } catch (e) {
            console.log("Creating new page", pageName);
            page = new Page(pageName, "", { name: pageName, lastModified: 0 });
          }
          this.openPages.set(pageName, page);
        }
        page.clientStates.add(
          new ClientPageState(clientConn.sock, page.version)
        );
        clientConn.openPages.add(pageName);
        console.log("Opened page", pageName);
        this.broadcastCursors(page);
        return page.toJSON();
      },
      pushUpdates: async (
        clientConn: ClientConnection,
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
                page!.cursors.set(c.userId, c);
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
          console.log(
            "New version",
            page.version,
            "Updates buffered:",
            page.updates.length
          );

          if (textChanged) {
            // Throttle
            if (!page.saveTimer) {
              page.saveTimer = setTimeout(() => {
                safeRun(async () => {
                  if (page) {
                    console.log(
                      "Persisting",
                      pageName,
                      " to disk and indexing."
                    );
                    await this.flushPageToDisk(pageName, page);

                    await this.eventFeature.dispatchEvent("page:index", {
                      name: pageName,
                      text: page.text.sliceString(0),
                    });
                    page.saveTimer = undefined;
                  }
                });
              }, 1000);
            }
          }
          while (page.pending.length) {
            page.pending.pop()!(transformedUpdates);
          }
          return true;
        }
      },

      pullUpdates: async (
        clientConn: ClientConnection,
        pageName: string,
        version: number
      ): Promise<Update[]> => {
        let page = this.openPages.get(pageName);
        // console.log("Pulling updates for", pageName);
        if (!page) {
          console.error("Fetching updates for not open page");
          return [];
        }
        // TODO: Optimize this
        let oldestVersion = Infinity;
        page.clientStates.forEach((client) => {
          oldestVersion = Math.min(client.version, oldestVersion);
          if (client.socket === clientConn.sock) {
            client.version = version;
          }
        });
        page.flushUpdates(oldestVersion);
        if (version < page.version) {
          return page.updatesSince(version);
        } else {
          return new Promise((resolve) => {
            page!.pending.push(resolve);
          });
        }
      },

      readPage: async (
        clientConn: ClientConnection,
        pageName: string
      ): Promise<{ text: string; meta: PageMeta }> => {
        let page = this.openPages.get(pageName);
        if (page) {
          console.log("Serving page from memory", pageName);
          return {
            text: page.text.sliceString(0),
            meta: page.meta,
          };
        } else {
          return this.pageStore.readPage(pageName);
        }
      },

      writePage: async (
        clientConn: ClientConnection,
        pageName: string,
        text: string
      ) => {
        let page = this.openPages.get(pageName);
        if (page) {
          for (let client of page.clientStates) {
            client.socket.emit("reloadPage", pageName);
          }
          this.openPages.delete(pageName);
        }
        return this.pageStore.writePage(pageName, text);
      },

      deletePage: async (clientConn: ClientConnection, pageName: string) => {
        this.openPages.delete(pageName);
        clientConn.openPages.delete(pageName);
        // Cascading of this to all connected clients will be handled by file watcher
        return this.pageStore.deletePage(pageName);
      },

      listPages: async (clientConn: ClientConnection): Promise<PageMeta[]> => {
        return this.pageStore.listPages();
      },

      getPageMeta: async (
        clientConn: ClientConnection,
        pageName: string
      ): Promise<PageMeta> => {
        let page = this.openPages.get(pageName);
        if (page) {
          return page.meta;
        }
        return this.pageStore.getPageMeta(pageName);
      },
    };
  }
}
