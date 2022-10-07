export {
  autocompletion,
  CompletionContext,
  completionKeymap,
} from "https://esm.sh/@codemirror/autocomplete@6.3.0?external=@codemirror/state,@lezer/common";
export type {
  Completion,
  CompletionResult,
} from "https://esm.sh/@codemirror/autocomplete@6.3.0?external=@codemirror/state,@lezer/common,@codemirror/view";

export * as YAML from "https://deno.land/std@0.158.0/encoding/yaml.ts";
export * as path from "https://deno.land/std@0.158.0/path/mod.ts";

export { readAll } from "https://deno.land/std@0.158.0/streams/conversion.ts";

export {
  decode as b64decode,
  encode as b64encode,
} from "https://deno.land/std@0.158.0/encoding/base64.ts";

export {
  history,
  historyKeymap,
  indentWithTab,
  standardKeymap,
} from "@codemirror/commands";
export {
  closeBrackets,
  closeBracketsKeymap,
} from "https://esm.sh/@codemirror/autocomplete@6.3.0?external=@codemirror/state,@codemirror/commands,@lezer/common,@codemirror/view";

export { styleTags, Tag, tagHighlighter, tags } from "@lezer/highlight";

export type {
  BlockContext,
  LeafBlock,
  LeafBlockParser,
  MarkdownConfig,
  MarkdownExtension,
} from "@lezer/markdown";

export {
  Emoji,
  GFM,
  MarkdownParser,
  parseCode,
  parser as baseParser,
  Subscript,
  Superscript,
  Table,
  TaskList,
} from "@lezer/markdown";

export type { SyntaxNode, Tree } from "@lezer/common";

export { searchKeymap } from "https://esm.sh/@codemirror/search@6.2.1?external=@codemirror/state,@codemirror/view";
export {
  Decoration,
  drawSelection,
  dropCursor,
  EditorView,
  highlightSpecialChars,
  keymap,
  runScopeHandlers,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from "@codemirror/view";
export type { DecorationSet, KeyBinding } from "@codemirror/view";

export { markdown } from "https://esm.sh/@codemirror/lang-markdown@6.0.1?external=@codemirror/state,@lezer/common,@codemirror/language,@lezer/markdown,@codemirror/view,@lezer/highlight";

export {
  EditorSelection,
  EditorState,
  Range,
  SelectionRange,
  Text,
  Transaction,
} from "@codemirror/state";
export type { ChangeSpec, StateCommand } from "@codemirror/state";
export {
  defaultHighlightStyle,
  defineLanguageFacet,
  foldNodeProp,
  HighlightStyle,
  indentNodeProp,
  Language,
  languageDataProp,
  LanguageDescription,
  LanguageSupport,
  ParseContext,
  syntaxHighlighting,
  syntaxTree,
} from "@codemirror/language";
