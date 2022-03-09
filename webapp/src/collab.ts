// TODO:
// Send state to client
// Shape of editor.editorView.state.toJSON({"cursors": cursorField})
// From there import it
// EditorState.fromJSON(js, {extensions: cursorField}, {cursors: cursorField})

import {
  collab,
  getSyncedVersion,
  receiveUpdates,
  sendableUpdates,
} from "@codemirror/collab";
import { EditorState, StateEffect, StateField, Text } from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { cursorEffect } from "./cursorEffect";
import { HttpRemoteSpace } from "./space";

export class Document {
  text: Text;
  version: number;

  constructor(text: Text, version: number) {
    this.text = text;
    this.version = version;
  }
}

let meId = "";

const cursorField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(cursors, tr) {
    cursors = cursors.map(tr.changes);
    for (let e of tr.effects) {
      if (e.is(cursorEffect)) {
        const newCursorDecoration = Decoration.widget({
          widget: new CursorWidget(e.value.userId, e.value.color, e.value.pos),
          side: 1,
        });
        cursors = cursors.update({
          filter: (from, to, d) => !d.eq(newCursorDecoration),
          // add: [newCursorDecoration.range(e.value.pos)],
          sort: true,
        });
      }
    }
    // console.log("New cursors", cursors.size);
    return cursors;
  },
  provide: (f) => EditorView.decorations.from(f),
  fromJSON(cursorJSONs) {
    let cursors = [];
    for (let cursorJSON of cursorJSONs) {
      cursors.push(
        Decoration.widget({
          widget: new CursorWidget(
            cursorJSON.userId,
            cursorJSON.color,
            cursorJSON.pos
          ),
          side: 1,
        }).range(cursorJSON.pos)
      );
    }
    return Decoration.set(cursors);
  },
  toJSON(cursors) {
    let cursor = cursors.iter();
    let results = [];
    while (cursor.value) {
      results.push({ ...cursor.value.spec.widget });
      cursor.next();
    }
    return results;
  },
});

class CursorWidget extends WidgetType {
  userId: string;
  color: string;
  pos: number;

  constructor(userId: string, color: string, pos: number) {
    super();
    this.userId = userId;
    this.color = color;
    this.pos = pos;
  }

  eq(other: CursorWidget) {
    return other.userId == this.userId;
  }

  toDOM() {
    let el = document.createElement("span");
    el.className = "other-cursor";
    el.style.backgroundColor = this.color;
    if (this.userId == meId) {
      el.style.display = "none";
    }
    return el;
  }
}

export function collabExtension(
  pageName: string,
  clientID: string,
  startVersion: number,
  space: HttpRemoteSpace,
  reloadCallback: () => void
) {
  meId = clientID;
  let plugin = ViewPlugin.fromClass(
    class {
      private pushing = false;
      private done = false;
      private failedPushes = 0;

      constructor(private view: EditorView) {
        if (pageName) {
          this.pull();
        }
      }

      update(update: ViewUpdate) {
        if (update.selectionSet) {
          let pos = update.state.selection.main.head;
          console.log("New pos", pos);
          // return;
          setTimeout(() => {
            update.view.dispatch({
              effects: [
                cursorEffect.of({ pos: pos, userId: clientID, color: "red" }),
              ],
            });
          });
        }
        let foundEffect = false;
        for (let tx of update.transactions) {
          if (tx.effects.some((e) => e.is(cursorEffect))) {
            foundEffect = true;
          }
        }
        if (update.docChanged || foundEffect) this.push();
      }

      async push() {
        let updates = sendableUpdates(this.view.state);
        if (this.pushing || !updates.length) return;
        console.log("Updates", updates);
        this.pushing = true;
        let version = getSyncedVersion(this.view.state);
        let success = await space.pushUpdates(pageName, version, updates);
        this.pushing = false;

        if (!success) {
          this.failedPushes++;
          if (this.failedPushes > 10) {
            // Not sure if 10 is a good number, but YOLO
            console.log("10 pushes failed, reloading");
            reloadCallback();
            return this.destroy();
          }
          console.log("Push failed temporarily, but will try again");
        } else {
          this.failedPushes = 0;
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
          let d = receiveUpdates(this.view.state, updates);
          console.log("Received", d);
          this.view.dispatch(d);
        }
      }

      destroy() {
        this.done = true;
      }
    }
  );

  return [
    collab({
      startVersion,
      clientID,
      sharedEffects: (tr) => {
        return tr.effects.filter((e) => e.is(cursorEffect));
      },
    }),
    cursorField,
    plugin,
  ];
}
