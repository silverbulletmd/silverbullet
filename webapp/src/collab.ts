import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { HttpRemoteSpace, Space } from "./space";
import {
  Update,
  receiveUpdates,
  sendableUpdates,
  collab,
  getSyncedVersion,
} from "@codemirror/collab";
import { PageMeta } from "./types";
import { Text } from "@codemirror/state";

export class Document {
  text: Text;
  meta: PageMeta;

  constructor(text: Text, meta: PageMeta) {
    this.text = text;
    this.meta = meta;
  }
}

export function collabExtension(
  pageName: string,
  startVersion: number,
  space: HttpRemoteSpace,
  reloadCallback: () => void
) {
  let plugin = ViewPlugin.fromClass(
    class {
      private pushing = false;
      private done = false;

      constructor(private view: EditorView) {
        if (pageName) {
          this.pull();
        }
      }

      update(update: ViewUpdate) {
        if (update.docChanged) this.push();
      }

      async push() {
        let updates = sendableUpdates(this.view.state);
        if (this.pushing || !updates.length) return;
        this.pushing = true;
        let version = getSyncedVersion(this.view.state);
        let success = await space.pushUpdates(pageName, version, updates);
        this.pushing = false;

        if (!success) {
          reloadCallback();
        }

        // Regardless of whether the push failed or new updates came in
        // while it was running, try again if there's updates remaining
        if (sendableUpdates(this.view.state).length) {
          setTimeout(() => this.push(), 100);
        }
      }

      async pull() {
        while (!this.done) {
          let version = getSyncedVersion(this.view.state);
          let updates = await space.pullUpdates(pageName, version);
          this.view.dispatch(receiveUpdates(this.view.state, updates));
        }
      }

      destroy() {
        this.done = true;
      }
    }
  );
  return [collab({ startVersion }), plugin];
}
