import { KeyBinding } from "@codemirror/view";

// TODO: Add support for selection (put quotes around or create blockquote block?)
function keyBindingForQuote(
  quote: string,
  left: string,
  right: string
): KeyBinding {
  return {
    key: quote,
    run: (target): boolean => {
      let cursorPos = target.state.selection.main.from;
      let chBefore = target.state.sliceDoc(cursorPos - 1, cursorPos);
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
