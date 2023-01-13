export {
  history,
  historyKeymap,
  indentWithTab,
  standardKeymap,
} from "@codemirror/commands";
export {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  CompletionContext,
  completionKeymap,
} from "@codemirror/autocomplete";
export type { Completion, CompletionResult } from "@codemirror/autocomplete";

export { styleTags, Tag, tagHighlighter, tags } from "@lezer/highlight";

export * as YAML from "https://deno.land/std@0.165.0/encoding/yaml.ts";
export * as path from "https://deno.land/std@0.165.0/path/mod.ts";

export { readAll } from "https://deno.land/std@0.165.0/streams/conversion.ts";

export type {
  BlockContext,
  Element,
  LeafBlock,
  LeafBlockParser,
  Line,
  MarkdownConfig,
  MarkdownExtension,
} from "@lezer/markdown";

export {
  Emoji,
  GFM,
  MarkdownParser,
  parseCode,
  parser as baseParser,
  Strikethrough,
  Subscript,
  Superscript,
  Table,
  TaskList,
} from "@lezer/markdown";

export type { NodeType, SyntaxNode, SyntaxNodeRef, Tree } from "@lezer/common";

export { searchKeymap } from "@codemirror/search";
export {
  Decoration,
  drawSelection,
  dropCursor,
  EditorView,
  highlightSpecialChars,
  keymap,
  placeholder,
  runScopeHandlers,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from "@codemirror/view";
export type { DecorationSet, KeyBinding } from "@codemirror/view";

export { markdown } from "https://esm.sh/@codemirror/lang-markdown@6.0.5?external=@codemirror/state,@lezer/common,@codemirror/language,@lezer/markdown,@codemirror/view,@lezer/highlight,@@codemirror/lang-html";

export {
  EditorSelection,
  EditorState,
  Range,
  SelectionRange,
  StateField,
  Text,
  Transaction,
} from "@codemirror/state";
export type { ChangeSpec, Extension, StateCommand } from "@codemirror/state";
export {
  defaultHighlightStyle,
  defineLanguageFacet,
  foldedRanges,
  foldInside,
  foldNodeProp,
  HighlightStyle,
  indentNodeProp,
  indentOnInput,
  Language,
  languageDataProp,
  LanguageDescription,
  LanguageSupport,
  ParseContext,
  StreamLanguage,
  syntaxHighlighting,
  syntaxTree,
} from "@codemirror/language";

export { yaml as yamlLanguage } from "https://esm.sh/@codemirror/legacy-modes@6.2.0/mode/yaml?external=@codemirror/language";
export { standardSQL as sqlLanguage } from "https://esm.sh/@codemirror/legacy-modes@6.3.1/mode/sql?external=@codemirror/language";
export {
  javascriptLanguage,
  typescriptLanguage,
} from "https://esm.sh/@codemirror/lang-javascript@6.1.2?external=@codemirror/language,@codemirror/autocomplete,@codemirror/view,@codemirror/state,@codemirror/lint,@lezer/common,@lezer/lr,@lezer/javascript,@codemirror/commands";
