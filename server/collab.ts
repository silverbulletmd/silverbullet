import { Hocuspocus } from "npm:@hocuspocus/server@2.0.6";
import { getAvailablePortSync } from "https://deno.land/x/port@1.0.0/mod.ts";
import { nanoid } from "https://esm.sh/nanoid@4.0.0";
import { race, timeout } from "../common/async_util.ts";
import { Application } from "./deps.ts";
import { SpacePrimitives } from "../common/spaces/space_primitives.ts";
import { collabPingInterval } from "../plugs/collab/constants.ts";

type CollabPage = {
  clients: Map<string, number>; // clientId -> lastPing
  collabId?: string;
};

export class CollabServer {
  // clients: Map<string, { openPage: string; lastPing: number }> = new Map();
  pages: Map<string, CollabPage> = new Map();

  constructor(private spacePrimitives: SpacePrimitives) {
  }

  start() {
    setInterval(() => {
      this.cleanup(3 * collabPingInterval);
    }, collabPingInterval);
  }

  ping(
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
        }
      }
    }

    if (currentPage) {
      // Update new page
      let nextCollabPage = this.pages.get(currentPage);
      if (!nextCollabPage) {
        nextCollabPage = {
          clients: new Map(),
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
        return { collabId: nextCollabPage.collabId };
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
          page.clients.delete(clientId);
        }
      }
      if (page.clients.size === 1) {
        // If there's only one client left, we don't need to keep the collabId around anymore
        delete page.collabId;
      }
      if (page.clients.size === 0) {
        this.pages.delete(pageName);
      }
    }
  }

  route(app: Application) {
    // The way this works is that we spin up a separate WS server locally and then proxy requests to it
    // This is the only way I could get Hocuspocus to work with Deno
    const internalPort = getAvailablePortSync();
    const hocuspocus = new Hocuspocus({
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
          hocuspocus.documents.delete(client.documentName);
        }
        return Promise.resolve();
      },
    });

    hocuspocus.listen();

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
