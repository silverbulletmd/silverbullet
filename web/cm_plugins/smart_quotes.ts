import { KeyBinding } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";

const straightQuoteContexts = [
  "CommentBlock",
  "CodeBlock",
  "FencedCode",
  "InlineCode",
  "FrontMatterCode",
  "Attribute",
  "CommandLink",
  "TemplateDirective",
];

// TODO: Add support for selection (put quotes around or create blockquote block?)
function keyBindingForQuote(
  quote: string,
  left: string,
  right: string,
): KeyBinding {
  return {
    any: (target, event): boolean => {
      // Moving this check here rather than using the regular "key" property because
      // for some reason the "ä" key is not recognized as a quote key by CodeMirror.
      if (event.key !== quote) {
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
      let q = right;
      if (/\W/.exec(chBefore) && !/[!\?,\.\-=“]/.exec(chBefore)) {
        q = left;
      }
      target.dispatch({
        changes: {
          insert: q,
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
