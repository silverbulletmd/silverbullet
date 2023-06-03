import { Hocuspocus } from "npm:@hocuspocus/server@2.0.6";
import { nanoid } from "https://esm.sh/nanoid@4.0.0";
import { race, timeout } from "../common/async_util.ts";
import { Application } from "./deps.ts";
import { SpacePrimitives } from "../common/spaces/space_primitives.ts";

type CollabPage = {
  clients: Set<string>; // clientIds
  collabId?: string;
};

const pingInterval = 5000;

export class CollabServer {
  clients: Map<string, { openPage: string; lastPing: number }> = new Map();
  pages: Map<string, CollabPage> = new Map();

  constructor(private spacePrimitives: SpacePrimitives) {
  }

  start() {
    setInterval(() => {
      this.cleanup(3 * pingInterval);
    }, pingInterval);
  }

  ping(clientId: string, currentPage: string): { collabId?: string } {
    let clientState = this.clients.get(clientId);
    let collabId: string | undefined;
    if (!clientState) {
      clientState = {
        openPage: "",
        lastPing: Date.now(),
      };
    } else {
      clientState.lastPing = Date.now();
    }
    if (currentPage !== clientState.openPage) {
      // Client switched pages
      // Update last page record
      const lastCollabPage = this.pages.get(clientState.openPage);
      if (lastCollabPage) {
        lastCollabPage.clients.delete(clientId);
        if (lastCollabPage.clients.size === 0) {
          // Cleanup
          this.pages.delete(clientState.openPage);
        } else {
          if (lastCollabPage.clients.size === 1) {
            delete lastCollabPage.collabId;
          }
          this.pages.set(clientState.openPage, lastCollabPage);
        }
      }
      // Update new page
      let nextCollabPage = this.pages.get(currentPage);
      if (!nextCollabPage) {
        nextCollabPage = {
          clients: new Set(),
        };
      }
      nextCollabPage.clients.add(clientId);
      // console.log(
      //   "Current number of clients for",
      //   currentPage,
      //   "is",
      //   nextCollabPage.clients.size,
      //   nextCollabPage.collabId,
      // );
      if (nextCollabPage.clients.size > 1 && !nextCollabPage.collabId) {
        // Create a new collabId
        nextCollabPage.collabId = nanoid();
      }
      clientState.openPage = currentPage;
      this.pages.set(currentPage, nextCollabPage);
      collabId = nextCollabPage.collabId;
    } else {
      // Page didn't change
      collabId = this.pages.get(currentPage)?.collabId;
    }
    this.clients.set(clientId, clientState);
    if (collabId) {
      return { collabId };
    } else {
      return {};
    }
  }

  cleanup(timeout: number) {
    // Clean up clients that haven't pinged for some time
    for (const [clientId, clientState] of this.clients) {
      if (Date.now() - clientState.lastPing > timeout) {
        console.log("[Collab]", "Ejecting client", clientId);
        this.clients.delete(clientId);
        const collabPage = this.pages.get(clientState.openPage);
        if (collabPage) {
          collabPage.clients.delete(clientId);
          if (collabPage.clients.size === 0) {
            this.pages.delete(clientState.openPage);
          } else {
            if (collabPage.clients.size === 1) {
              delete collabPage.collabId;
            }
            this.pages.set(clientState.openPage, collabPage);
          }
        }
      }
    }
  }

  route(app: Express.Application) {
    const hocuspocus = new Hocuspocus({
      quiet: true,
      onLoadDocument: async (doc) => {
        console.log("[Hocuspocus]", "Requesting doc load", doc.documentName);
        const [collabId, pageName] = splitCollabId(doc.documentName);
        const collabPage = this.pages.get(pageName);
        if (!collabPage || collabPage.collabId !== collabId) {
          // This can happen after a server restart (or a multi-server setup which we don't yet support),
          // where old clients are still trying to continue on an old session
          // This will self-correct when the client discovers that the collabId has changed
          // Until then: HARD PASS (meaning: don't send a document)
          console.warn(
            "[Hocuspocus]",
            "Client tried to connect to old session",
            doc.documentName,
          );
          return;
        }
        try {
          const yText = doc.document.getText("codemirror");
          // Read document from space and load it into Yjs
          const { data } = await this.spacePrimitives.readFile(
            `${pageName}.md`,
          );

          yText.insert(0, new TextDecoder().decode(data));
          console.log("[Hocuspocus]", "Loaded document from space");
          return doc.document;
        } catch (e) {
          console.error("Error loading doc", e);
        }
      },
      onStoreDocument: async (data) => {
        const [_, pageName] = splitCollabId(data.documentName);
        const path = `${pageName}.md`;
        const text = data.document.getText("codemirror").toString();
        console.log(
          "[Hocuspocus]",
          "Persisting",
          pageName,
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

    // hocuspocus.listen();
    app.ws("/.ws-collab", (ws, req) => {
      hocuspocus.handleConnection(ws, req);
    });
}

function splitCollabId(documentName: string): [string, string] {
  const [collabId, ...pageNamePieces] = documentName.split("/");
  const pageName = pageNamePieces.join("/");
  return [collabId, pageName];
}
