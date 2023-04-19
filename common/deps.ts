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

export * as YAML from "https://deno.land/std@0.184.0/yaml/mod.ts";
export * as path from "https://deno.land/std@0.184.0/path/mod.ts";

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

export { markdown } from "https://esm.sh/@codemirror/lang-markdown@6.1.0?external=@codemirror/state,@lezer/common,@codemirror/language,@lezer/markdown,@codemirror/view,@lezer/highlight,@@codemirror/lang-html";

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

export { yaml as yamlLanguage } from "https://esm.sh/@codemirror/legacy-modes@6.3.1/mode/yaml?external=@codemirror/language";
export {
  pgSQL as postgresqlLanguage,
  standardSQL as sqlLanguage,
} from "https://esm.sh/@codemirror/legacy-modes@6.3.1/mode/sql?external=@codemirror/language";
export { rust as rustLanguage } from "https://esm.sh/@codemirror/legacy-modes@6.3.1/mode/rust?external=@codemirror/language";
export { css as cssLanguage } from "https://esm.sh/@codemirror/legacy-modes@6.3.1/mode/css?external=@codemirror/language";
export { python as pythonLanguage } from "https://esm.sh/@codemirror/legacy-modes@6.3.1/mode/python?external=@codemirror/language";
export { protobuf as protobufLanguage } from "https://esm.sh/@codemirror/legacy-modes@6.3.1/mode/protobuf?external=@codemirror/language";
export { shell as shellLanguage } from "https://esm.sh/@codemirror/legacy-modes@6.3.1/mode/shell?external=@codemirror/language";
export { swift as swiftLanguage } from "https://esm.sh/@codemirror/legacy-modes@6.3.1/mode/swift?external=@codemirror/language";
export { toml as tomlLanguage } from "https://esm.sh/@codemirror/legacy-modes@6.3.1/mode/toml?external=@codemirror/language";
export { xml as xmlLanguage } from "https://esm.sh/@codemirror/legacy-modes@6.3.1/mode/xml?external=@codemirror/language";
export { json as jsonLanguage } from "https://esm.sh/@codemirror/legacy-modes@6.3.1/mode/javascript?external=@codemirror/language";
export {
  c as cLanguage,
  cpp as cppLanguage,
  csharp as csharpLanguage,
  dart as dartLanguage,
  java as javaLanguage,
  kotlin as kotlinLanguage,
  objectiveC as objectiveCLanguage,
  objectiveCpp as objectiveCppLanguage,
  scala as scalaLanguage,
} from "https://esm.sh/@codemirror/legacy-modes@6.3.1/mode/clike?external=@codemirror/language";

export {
  javascriptLanguage,
  typescriptLanguage,
} from "https://esm.sh/@codemirror/lang-javascript@6.1.4?external=@codemirror/language,@codemirror/autocomplete,@codemirror/view,@codemirror/state,@codemirror/lint,@lezer/common,@lezer/lr,@lezer/javascript,@codemirror/commands";
