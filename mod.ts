import React from "https://esm.sh/v96/@types/react@~17.0/index.d.ts";

export {
  autocompletion,
  completionKeymap,
} from "https://esm.sh/@codemirror/autocomplete@6.3.0?external=@codemirror/state";

export {
  defaultHighlightStyle,
  syntaxHighlighting,
  syntaxTree,
} from "https://esm.sh/@codemirror/language@6.2.1?external=@codemirror/state";
export { markdown } from "https://esm.sh/@codemirror/lang-markdown@6.0.1?external=@codemirror/state";
export {
  history,
  historyKeymap,
  indentWithTab,
  standardKeymap,
} from "https://esm.sh/@codemirror/commands@6.1.1?external=@codemirror/state";
export {
  closeBrackets,
  closeBracketsKeymap,
} from "https://esm.sh/@codemirror/autocomplete@6.3.0?external=@codemirror/state";

export {
  searchKeymap,
} from "https://esm.sh/@codemirror/search?external=@codemirror/state";

export {
  drawSelection,
  dropCursor,
  EditorView,
  highlightSpecialChars,
  keymap,
  runScopeHandlers,
  ViewPlugin,
  ViewUpdate,
} from "https://esm.sh/@codemirror/view@6.3.0?external=@codemirror/state";
export type { KeyBinding } from "https://esm.sh/@codemirror/view@6.3.0?external=@codemirror/state";

// export * as react from "https://esm.sh/react@17";

export { EditorSelection, EditorState } from "@codemirror/state";
