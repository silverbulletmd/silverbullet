export {
  autocompletion,
  completionKeymap,
} from "https://esm.sh/@codemirror/autocomplete@6.3.0?external=@codemirror/state";

export * as YAML from "https://deno.land/std@0.158.0/encoding/yaml.ts";
export * as path from "https://deno.land/std@0.158.0/path/mod.ts";

export { readAll } from "https://deno.land/std@0.158.0/streams/conversion.ts";

export {
  encode as b64encode,
  decode as b64decode,
} from "https://deno.land/std/encoding/base64.ts";

export {
  defaultHighlightStyle,
  Language,
  LanguageSupport,
  LanguageDescription,
  syntaxHighlighting,
  syntaxTree,
  defineLanguageFacet,
  languageDataProp,
  foldNodeProp,
  indentNodeProp,
  ParseContext,
} from "@codemirror/language";
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

export { styleTags, Tag, tags } from "https://esm.sh/@lezer/highlight";

export type {
  BlockContext,
  LeafBlock,
  LeafBlockParser,
  MarkdownConfig,
  Table,
  TaskList,
  MarkdownExtension,
} from "https://esm.sh/@lezer/markdown";

export {
  MarkdownParser,
  parseCode,
  parser as baseParser,
  GFM,
  Subscript,
  Superscript,
  Emoji,
} from "https://esm.sh/@lezer/markdown";

export type { SyntaxNode, Tree } from "https://esm.sh/@lezer/common";

export { searchKeymap } from "https://esm.sh/@codemirror/search?external=@codemirror/state";

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

export { EditorSelection, EditorState, Text } from "@codemirror/state";
export type { StateCommand, ChangeSpec } from "@codemirror/state";

export { DB as SQLite3 } from "https://deno.land/x/sqlite/mod.ts";

// @deno-types="https://deno.land/x/dex@1.0.2/types/index.d.ts"
export { default as Dex } from "https://deno.land/x/dex@1.0.2/mod.ts";
