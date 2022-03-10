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
import { RangeSetBuilder, Range } from "@codemirror/rangeset";
import { EditorState, StateEffect, StateField, Text } from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { Cursor, cursorEffect } from "./cursorEffect";
import { HttpRemoteSpace } from "./space";

const throttleInterval = 250;

const throttle = (func: () => void, limit: number) => {
  let timer: any = null;
  return function () {
    if (!timer) {
      timer = setTimeout(() => {
        func();
        timer = null;
      }, limit);
    }
  };
};

//@ts-ignore
window.throttle = throttle;

export class Document {
  text: Text;
  version: number;
  cursors: Map<string, Cursor>;

  constructor(text: Text, version: number, cursors: Map<string, Cursor>) {
    this.text = text;
    this.version = version;
    this.cursors = cursors;
  }
}

class CursorWidget extends WidgetType {
  userId: string;
  color: string;

  constructor(userId: string, color: string) {
    super();
    this.userId = userId;
    this.color = color;
  }

  eq(other: CursorWidget) {
    return other.userId == this.userId;
  }

  toDOM() {
    let el = document.createElement("span");
    el.className = "other-cursor";
    el.style.backgroundColor = this.color;
    // let nameSpanContainer = document.createElement("span");
    // nameSpanContainer.className = "cursor-label-container";
    // let nameSpanLabel = document.createElement("label");
    // nameSpanLabel.className = "cursor-label";
    // nameSpanLabel.textContent = this.userId;
    // nameSpanContainer.appendChild(nameSpanLabel);
    // el.appendChild(nameSpanContainer);
    return el;
  }
}

export function collabExtension(
  pageName: string,
  clientID: string,
  doc: Document,
  space: HttpRemoteSpace,
  reloadCallback: () => void
) {
  let plugin = ViewPlugin.fromClass(
    class {
      private pushing = false;
      private done = false;
      private failedPushes = 0;
      decorations: DecorationSet;
      private cursorPositions: Map<string, Cursor> = doc.cursors;
      throttledPush: () => void;

      buildDecorations(view: EditorView) {
        let builder = new RangeSetBuilder<Decoration>();

        let list = [];
        for (let [userId, def] of this.cursorPositions) {
          if (userId == clientID) {
            continue;
          }
          list.push({
            pos: def.pos,
            widget: Decoration.widget({
              widget: new CursorWidget(userId, def.color),
              side: 1,
            }),
          });
        }

        list
          .sort((a, b) => a.pos - b.pos)
          .forEach((r) => {
            builder.add(r.pos, r.pos, r.widget);
          });

        return builder.finish();
      }

      constructor(private view: EditorView) {
        if (pageName) {
          this.pull();
        }
        this.decorations = this.buildDecorations(view);
        this.throttledPush = throttle(() => this.push(), throttleInterval);

        console.log("Created collabo plug");
        space.addEventListener("cursors", this.updateCursors);
      }

      updateCursors(cursorEvent: any) {
        this.cursorPositions = new Map();
        console.log("Received new cursor snapshot", cursorEvent.detail, this);
        for (let userId in cursorEvent.detail) {
          this.cursorPositions.set(userId, cursorEvent.detail[userId]);
        }
      }

      update(update: ViewUpdate) {
        if (update.selectionSet) {
          let pos = update.state.selection.main.head;
          // if (pos === 0) {
          //   console.error("Warning: position reset? at 0");
          //   console.trace();
          // }
          setTimeout(() => {
            update.view.dispatch({
              effects: [
                cursorEffect.of({ pos: pos, userId: clientID, color: "red" }),
              ],
            });
          });
        }
        let foundCursorMoves = new Set<string>();
        for (let tx of update.transactions) {
          let cursorMove = tx.effects.find((e) => e.is(cursorEffect));
          if (cursorMove) {
            foundCursorMoves.add(cursorMove.value.userId);
          }
        }
        // Update cursors
        for (let cursor of this.cursorPositions.values()) {
          if (foundCursorMoves.has(cursor.userId)) {
            // Already got a cursor update for this one, no need to manually map
            continue;
          }
          update.transactions.forEach((tx) => {
            cursor.pos = tx.changes.mapPos(cursor.pos);
          });
        }
        this.decorations = this.buildDecorations(update.view);
        if (update.docChanged || foundCursorMoves.size > 0) {
          this.throttledPush();
        }
      }

      async push() {
        let updates = sendableUpdates(this.view.state);
        // TODO: compose multiple updates into one
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
          // setTimeout(() => this.push(), 100);
          this.throttledPush();
        }
      }

      async pull() {
        while (!this.done) {
          let version = getSyncedVersion(this.view.state);
          let updates = await space.pullUpdates(pageName, version);
          let d = receiveUpdates(this.view.state, updates);
          // Pull out cursor updates and update local state
          for (let update of updates) {
            if (update.effects) {
              for (let effect of update.effects) {
                if (effect.is(cursorEffect)) {
                  this.cursorPositions.set(effect.value.userId, {
                    userId: effect.value.userId,
                    pos: effect.value.pos,
                    color: effect.value.color,
                  });
                }
              }
            }
          }
          this.view.dispatch(d);
        }
      }

      destroy() {
        this.done = true;
        space.removeEventListener("cursors", this.updateCursors);
      }
    },
    {
      decorations: (v) => v.decorations,
    }
  );

  return [
    collab({
      startVersion: doc.version,
      clientID,
      sharedEffects: (tr) => {
        return tr.effects.filter((e) => e.is(cursorEffect));
      },
    }),
    // cursorField,
    plugin,
  ];
}
