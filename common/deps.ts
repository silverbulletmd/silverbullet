export { styleTags, Tag, tagHighlighter, tags } from "@lezer/highlight";

export * as YAML from "js-yaml";
export * as path from "$std/path/mod.ts";

import {
  Intl,
  Temporal,
  toTemporalInstant,
} from "https://esm.sh/@js-temporal/polyfill@0.4.4";

// @ts-ignore: temporal polygifill
Date.prototype.toTemporalInstant = toTemporalInstant;
// @ts-ignore: Temporal polyfill
globalThis.Temporal = Temporal;
// @ts-ignore: Intl polyfill
globalThis.Intl = Intl;

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

export { markdown } from "@codemirror/lang-markdown";

// Language modes
export { yaml as yamlLanguage } from "@codemirror/legacy-modes/mode/yaml?external=@codemirror/language&target=es2022";
export {
  pgSQL as postgresqlLanguage,
  standardSQL as sqlLanguage,
} from "@codemirror/legacy-modes/mode/sql?external=@codemirror/language&target=es2022";
export { rust as rustLanguage } from "@codemirror/legacy-modes/mode/rust?external=@codemirror/language&target=es2022";
export { css as cssLanguage } from "@codemirror/legacy-modes/mode/css?external=@codemirror/language&target=es2022";
export { python as pythonLanguage } from "@codemirror/legacy-modes/mode/python?external=@codemirror/language&target=es2022";
export { protobuf as protobufLanguage } from "@codemirror/legacy-modes/mode/protobuf?external=@codemirror/language&target=es2022";
export { shell as shellLanguage } from "@codemirror/legacy-modes/mode/shell?external=@codemirror/language&target=es2022";
export { swift as swiftLanguage } from "@codemirror/legacy-modes/mode/swift?external=@codemirror/language&target=es2022";
export { toml as tomlLanguage } from "@codemirror/legacy-modes/mode/toml?external=@codemirror/language&target=es2022";
export { xml as xmlLanguage } from "@codemirror/legacy-modes/mode/xml?external=@codemirror/language&target=es2022";
export { json as jsonLanguage } from "@codemirror/legacy-modes/mode/javascript?external=@codemirror/language&target=es2022";
export { htmlLanguage } from "@codemirror/lang-html";

export { Language, StreamLanguage } from "@codemirror/language";

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
} from "@codemirror/legacy-modes/mode/clike?external=@codemirror/language&target=es2022";

export {
  javascriptLanguage,
  typescriptLanguage,
} from "@codemirror/lang-javascript";

export { mime } from "mimetypes";

export { compile as gitIgnoreCompiler } from "gitignore-parser";

export { z } from "zod";
