import { safeRun } from "../../common/util.ts";
import { Extension, HocuspocusProvider, Y, yCollab } from "../deps.ts";
import { SyncService } from "../sync_service.ts";

const userColors = [
  { color: "#30bced", light: "#30bced33" },
  { color: "#6eeb83", light: "#6eeb8333" },
  { color: "#ffbc42", light: "#ffbc4233" },
  { color: "#ecd444", light: "#ecd44433" },
  { color: "#ee6352", light: "#ee635233" },
  { color: "#9ac2c9", light: "#9ac2c933" },
  { color: "#8acb88", light: "#8acb8833" },
  { color: "#1be7ff", light: "#1be7ff33" },
];

export class CollabState {
  public ytext: Y.Text;
  collabProvider: HocuspocusProvider;
  private yundoManager: Y.UndoManager;
  interval?: number;

  constructor(
    serverUrl: string,
    readonly path: string,
    readonly token: string,
    username: string,
    private syncService: SyncService,
    public isLocalCollab: boolean,
  ) {
    this.collabProvider = new HocuspocusProvider({
      url: serverUrl,
      name: token,

      // Receive broadcasted messages from the server (right now only "page has been persisted" notifications)
      onStateless: (
        { payload },
      ) => {
        const message = JSON.parse(payload);
        switch (message.type) {
          case "persisted": {
            // Received remote persist notification, updating snapshot
            syncService.updateRemoteLastModified(
              message.path,
              message.lastModified,
            ).catch(console.error);
          }
        }
      },
    });

    this.collabProvider.on("status", (e: any) => {
      console.log("Collab status change", e);
    });

    this.ytext = this.collabProvider.document.getText("codemirror");
    this.yundoManager = new Y.UndoManager(this.ytext);

    const randomColor =
      userColors[Math.floor(Math.random() * userColors.length)];

    this.collabProvider.awareness.setLocalStateField("user", {
      name: username,
      color: randomColor.color,
      colorLight: randomColor.light,
    });
    if (isLocalCollab) {
      syncService.excludeFromSync(path).catch(console.error);

      this.interval = setInterval(() => {
        // Ping the store to make sure the file remains in exclusion
        syncService.excludeFromSync(path).catch(console.error);
      }, 1000);
    }
  }

  stop() {
    console.log("[COLLAB] Destroying collab provider");
    if (this.interval) {
      clearInterval(this.interval);
    }
    this.collabProvider.destroy();
    // For whatever reason, destroy() doesn't properly clean up everything so we need to help a bit
    this.collabProvider.configuration.websocketProvider.webSocket = null;
    this.collabProvider.configuration.websocketProvider.destroy();

    // When stopping collaboration, we're going back to sync mode. Make sure we got the latest and greatest remote timestamp to avoid
    // conflicts
    safeRun(async () => {
      await this.syncService.unExcludeFromSync(this.path);
      await this.syncService.fetchAndPersistRemoteLastModified(this.path);
    });
  }

  collabExtension(): Extension {
    return yCollab(this.ytext, this.collabProvider.awareness, {
      undoManager: this.yundoManager,
    });
  }
}
