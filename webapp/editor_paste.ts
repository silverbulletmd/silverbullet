import { ViewPlugin, ViewUpdate } from "@codemirror/view";
import { urlRegexp } from "./parser";

export const pasteLinkExtension = ViewPlugin.fromClass(
  class {
    update(update: ViewUpdate): void {
      update.transactions.forEach((tr) => {
        if (tr.isUserEvent("input.paste")) {
          let pastedText: string[] = [];
          let from = 0;
          let to = 0;
          tr.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
            pastedText.push(inserted.sliceString(0));
            from = fromA;
            to = toB;
          });
          let pastedString = pastedText.join("");
          if (pastedString.match(urlRegexp)) {
            let selection = update.startState.selection.main;
            if (!selection.empty) {
              setTimeout(() => {
                update.view.dispatch({
                  changes: [
                    {
                      from: from,
                      to: to,
                      insert: `[${update.startState.sliceDoc(
                        selection.from,
                        selection.to
                      )}](${pastedString})`,
                    },
                  ],
                });
              });
            }
          }
        }
      });
    }
  }
);
