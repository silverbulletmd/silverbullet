import type { KeyBinding } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { EditorSelection } from "@codemirror/state";
import type { Client } from "../client.ts";

import type { SmartQuotesConfig } from "../../type/config.ts";

const straightQuoteContexts = [
  "CommentBlock",
  "CodeBlock",
  "CodeText",
  "FencedCode",
  "InlineCode",
  "FrontMatterCode",
  "Attribute",
  "CommandLink",
  "LuaDirective",
];

// TODO: Add support for selection (put quotes around or create blockquote block?)
function keyBindingForQuote(
  originalQuote: string,
  left: string,
  right: string,
): KeyBinding {
  return {
    any: (target, event): boolean => {
      // Moving this check here rather than using the regular "key" property because
      // for some reason the "ä" key is not recognized as a quote key by CodeMirror.
      if (event.key !== originalQuote) {
        return false;
      }
      const cursorPos = target.state.selection.main.from;
      const chBefore = target.state.sliceDoc(cursorPos - 1, cursorPos);

      // Figure out the context, if in some sort of code/comment fragment don't be smart
      let node = syntaxTree(target.state).resolveInner(cursorPos);
      while (node) {
        if (straightQuoteContexts.includes(node.type.name)) {
          return false;
        }
        if (node.parent) {
          node = node.parent;
        } else {
          break;
        }
      }

      // Ok, still here, let's use a smart quote
      const changes = target.state.changeByRange((range) => {
        if (!range.empty) {
          return {
            changes: [
              { insert: left, from: range.from },
              { insert: right, from: range.to },
            ],
            range: EditorSelection.range(
              range.anchor + left.length,
              range.head + left.length,
            ),
          };
        } else {
          const quote = (/\W/.exec(chBefore) && !/[!\?,\.\-=“]/.exec(chBefore))
            ? left
            : right;

          return {
            changes: {
              insert: quote,
              from: cursorPos,
            },
            range: EditorSelection.cursor(
              range.anchor + quote.length,
            ),
          };
        }
      });
      target.dispatch(changes);

      return true;
    },
  };
}

export function createSmartQuoteKeyBindings(client: Client): KeyBinding[] {
  const smartQuotes = client.config.get<SmartQuotesConfig>("smartQuotes", {});
  if (
    smartQuotes.enabled === false
  ) {
    return [];
  }

  let doubleLeft = "“";
  let doubleRight = "”";
  let singleLeft = "‘";
  let singleRight = "’";
  if (typeof smartQuotes.double?.left === "string") {
    doubleLeft = smartQuotes.double!.left;
  }
  if (typeof smartQuotes.double?.right === "string") {
    doubleRight = smartQuotes.double!.right;
  }
  if (typeof smartQuotes.single?.left === "string") {
    singleLeft = smartQuotes.single!.left;
  }
  if (typeof smartQuotes.single?.right === "string") {
    singleRight = smartQuotes.single!.right;
  }

  return [
    keyBindingForQuote('"', doubleLeft, doubleRight),
    keyBindingForQuote("'", singleLeft, singleRight),
  ];
}
