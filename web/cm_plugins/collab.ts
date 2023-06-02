import { Extension, HocuspocusProvider, Y, yCollab } from "../deps.ts";

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

  constructor(
    serverUrl: string,
    name: string,
    username: string,
    onStateless: (data: any) => any,
  ) {
    this.collabProvider = new HocuspocusProvider({
      url: serverUrl,
      name: name,
      onStateless,
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
  }

  stop() {
    // this.collabProvider.disconnect();
    console.log("[COLLAB] Destroying collab provider");
    this.collabProvider.destroy();
    // For whatever reason, destroy() doesn't properly clean up everything so we need to help a bit
    this.collabProvider.configuration.websocketProvider.webSocket = null;
    this.collabProvider.configuration.websocketProvider.destroy();
  }

  collabExtension(): Extension {
    return yCollab(this.ytext, this.collabProvider.awareness, {
      undoManager: this.yundoManager,
    });
  }
}
