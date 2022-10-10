import { KeyBinding } from "./deps.ts";
import { syntaxTree } from "../common/deps.ts";

const straightQuoteContexts = ["CommentBlock", "FencedCode", "InlineCode"];

// TODO: Add support for selection (put quotes around or create blockquote block?)
function keyBindingForQuote(
  quote: string,
  left: string,
  right: string,
): KeyBinding {
  return {
    key: quote,
    run: (target): boolean => {
      let cursorPos = target.state.selection.main.from;
      let chBefore = target.state.sliceDoc(cursorPos - 1, cursorPos);

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
      let quote = right;
      if (/\W/.exec(chBefore) && !/[!\?,\.\-=“]/.exec(chBefore)) {
        quote = left;
      }
      target.dispatch({
        changes: {
          insert: quote,
          from: cursorPos,
        },
        selection: {
          anchor: cursorPos + 1,
        },
      });
      return true;
    },
  };
}

export const smartQuoteKeymap: KeyBinding[] = [
  keyBindingForQuote('"', "“", "”"),
  keyBindingForQuote("'", "‘", "’"),
];
