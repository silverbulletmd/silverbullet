import { nanoid } from "https://esm.sh/nanoid@4.0.0";
import type { Editor } from "./editor.tsx";

const collabPingInterval = 2500;

export class CollabManager {
  clientId = nanoid();
  localCollabServer: string;

  constructor(private editor: Editor) {
    this.localCollabServer = location.protocol === "http:"
      ? `ws://${location.host}/.ws-collab`
      : `wss://${location.host}/.ws-collab`;
    editor.eventHook.addLocalListener(
      "editor:pageLoaded",
      (pageName, previousPage) => {
        console.log("Page loaded", pageName, previousPage);
        this.updatePresence(pageName).catch(console.error);
      },
    );
  }

  start() {
    setInterval(() => {
      this.updatePresence(this.editor.currentPage!).catch(console.error);
    }, collabPingInterval);
  }

  async updatePresence(currentPage: string) {
    try {
      // This is signaled through an OPTIONS call on the file we have open
      const resp = await this.editor.remoteSpacePrimitives.authenticatedFetch(
        `${this.editor.remoteSpacePrimitives.url}/${currentPage}.md`,
        {
          method: "OPTIONS",
          headers: {
            "X-Client-Id": this.clientId,
          },
        },
      );
      const collabId = resp.headers.get("X-Collab-Id");
      // Not reading body at all, is that a problem?

      if (this.editor.collabState && !this.editor.collabState.isLocalCollab) {
        // We're in a remote collab mode, don't do anything
        return;
      }

      // console.log("Collab ID", collabId);
      const previousCollabId = this.editor.collabState?.token.split("/")[0];
      if (!collabId && this.editor.collabState) {
        // Stop collab
        console.log("Stopping collab");
        if (this.editor.collabState.path === `${currentPage}.md`) {
          this.editor.flashNotification(
            "Other users have left this page, switched back to single-user mode.",
          );
        }
        this.editor.stopCollab();
      } else if (collabId && collabId !== previousCollabId) {
        // Start collab
        console.log("Starting collab");
        this.editor.flashNotification(
          "Opening page in multi-user mode.",
        );
        this.editor.startCollab(
          this.localCollabServer,
          `${collabId}/${currentPage}.md`,
          this.editor.getUsername(),
          true,
        );
      }
    } catch (e: any) {
      // console.error("Ping error", e);
      if (
        e.message.toLowerCase().includes("failed") && this.editor.collabState
      ) {
        console.log("Offline, stopping collab");
        this.editor.stopCollab();
      }
    }
  }
}
