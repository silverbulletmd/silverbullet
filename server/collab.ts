import { getAvailablePortSync } from "https://deno.land/x/port@1.0.0/mod.ts";
import { nanoid } from "https://esm.sh/nanoid@4.0.0";
import { race, timeout } from "../common/async_util.ts";
import { Application } from "./deps.ts";
import { SpacePrimitives } from "../common/spaces/space_primitives.ts";
import { collabPingInterval } from "../plugs/collab/constants.ts";
import { Hocuspocus } from "./deps.ts";

type CollabPage = {
  clients: Map<string, number>; // clientId -> lastPing
  collabId?: string;
  // The currently elected provider of the initial document
  masterClientId: string;
};

export class CollabServer {
  // clients: Map<string, { openPage: string; lastPing: number }> = new Map();
  pages: Map<string, CollabPage> = new Map();
  yCollabServer?: Hocuspocus;

  constructor(private spacePrimitives: SpacePrimitives) {
  }

  start() {
    setInterval(() => {
      this.cleanup(3 * collabPingInterval);
    }, collabPingInterval);
  }

  updatePresence(
    clientId: string,
    currentPage?: string,
    previousPage?: string,
  ): { collabId?: string } {
    if (previousPage && currentPage !== previousPage) {
      // Client switched pages
      // Update last page record
      const lastCollabPage = this.pages.get(previousPage);
      if (lastCollabPage) {
        lastCollabPage.clients.delete(clientId);
        if (lastCollabPage.clients.size === 1) {
          delete lastCollabPage.collabId;
        }

        if (lastCollabPage.clients.size === 0) {
          this.pages.delete(previousPage);
        } else {
          // Elect a new master client
          if (lastCollabPage.masterClientId === clientId) {
            // Any is fine, really
            lastCollabPage.masterClientId =
              [...lastCollabPage.clients.keys()][0];
          }
        }
      }
    }

    if (currentPage) {
      // Update new page
      let nextCollabPage = this.pages.get(currentPage);
      if (!nextCollabPage) {
        // Newly opened page (no other clients on this page right now)
        nextCollabPage = {
          clients: new Map(),
          masterClientId: clientId,
        };
        this.pages.set(currentPage, nextCollabPage);
      }
      // Register last ping from us
      nextCollabPage.clients.set(clientId, Date.now());

      if (nextCollabPage.clients.size > 1 && !nextCollabPage.collabId) {
        // Create a new collabId
        nextCollabPage.collabId = nanoid();
      }
      // console.log("State", this.pages);
      if (nextCollabPage.collabId) {
        // We will now expose this collabId, except when we're just starting this session
        // in which case we'll wait for the original client to publish the document
        const existingyCollabSession = this.yCollabServer?.documents.get(
          buildCollabId(nextCollabPage.collabId, `${currentPage}.md`),
        );
        if (existingyCollabSession) {
          // console.log("Found an existing collab session already, let's join!");
          return { collabId: nextCollabPage.collabId };
        } else if (clientId === nextCollabPage.masterClientId) {
          // console.log("We're the master, so we should connect");
          return { collabId: nextCollabPage.collabId };
        } else {
          // We're not the first client, so we need to wait for the first client to connect
          // console.log("We're not the master, so we should wait");
          return {};
        }
      } else {
        return {};
      }
    } else {
      return {};
    }
  }

  cleanup(timeout: number) {
    // Clean up pages and their clients that haven't pinged for some time
    for (const [pageName, page] of this.pages) {
      for (const [clientId, lastPing] of page.clients) {
        if (Date.now() - lastPing > timeout) {
          // Eject client
          page.clients.delete(clientId);
          // Elect a new master client
          if (page.masterClientId === clientId && page.clients.size > 0) {
            page.masterClientId = [...page.clients.keys()][0];
          }
        }
      }
      if (page.clients.size === 1) {
        // If there's only one client left, we don't need to keep the collabId around anymore
        delete page.collabId;
      }
      if (page.clients.size === 0) {
        // And if we have no clients left, well...
        this.pages.delete(pageName);
      }
    }
  }

  route(app: Application) {
    // The way this works is that we spin up a separate WS server locally and then proxy requests to it
    // This is the only way I could get Hocuspocus to work with Deno
    const internalPort = getAvailablePortSync();
    this.yCollabServer = new Hocuspocus({
      port: internalPort,
      address: "127.0.0.1",
      quiet: true,
      onStoreDocument: async (data) => {
        const [_, path] = splitCollabId(data.documentName);
        const text = data.document.getText("codemirror").toString();
        console.log(
          "[Hocuspocus]",
          "Persisting",
          path,
          "to space on server",
        );
        const meta = await this.spacePrimitives.writeFile(
          path,
          new TextEncoder().encode(text),
        );
        // Broadcast new persisted lastModified date
        data.document.broadcastStateless(
          JSON.stringify({
            type: "persisted",
            path,
            lastModified: meta.lastModified,
          }),
        );
        return;
      },
      onDisconnect: (client) => {
        console.log("[Hocuspocus]", "Client disconnected", client.clientsCount);
        if (client.clientsCount === 0) {
          console.log(
            "[Hocuspocus]",
            "Last client disconnected from",
            client.documentName,
            "purging from memory",
          );
          this.yCollabServer!.documents.delete(client.documentName);
        }
        return Promise.resolve();
      },
    });

    this.yCollabServer.listen();

    app.use((ctx) => {
      // if (ctx.request.url.pathname === "/.ws") {
      //   const sock = ctx.upgrade();
      //   sock.onmessage = (e) => {
      //     console.log("WS: Got message", e.data);
      //   };
      // }
      // Websocket proxy to hocuspocus
      if (ctx.request.url.pathname === "/.ws-collab") {
        const sock = ctx.upgrade();

        const ws = new WebSocket(`ws://localhost:${internalPort}`);
        const wsReady = race([
          new Promise<void>((resolve) => {
            ws.onopen = () => {
              resolve();
            };
          }),
          timeout(1000),
        ]).catch(() => {
          console.error("Timeout waiting for collab to open websocket");
          sock.close();
        });
        sock.onmessage = (e) => {
          // console.log("Got message", e);
          wsReady.then(() => ws.send(e.data)).catch(console.error);
        };
        sock.onclose = () => {
          if (ws.OPEN) {
            ws.close();
          }
        };
        ws.onmessage = (e) => {
          if (sock.OPEN) {
            sock.send(e.data);
          } else {
            console.error("Got message from websocket but socket is not open");
          }
        };
        ws.onclose = () => {
          if (sock.OPEN) {
            sock.close();
          }
        };
      }
    });
  }
}

function splitCollabId(documentName: string): [string, string] {
  const [collabId, ...pathPieces] = documentName.split("/");
  const path = pathPieces.join("/");
  return [collabId, path];
}

function buildCollabId(collabId: string, path: string): string {
  return `${collabId}/${path}`;
}
