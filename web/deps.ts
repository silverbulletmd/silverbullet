export {
  history,
  historyKeymap,
  indentWithTab,
  redo,
  standardKeymap,
  undo,
} from "@codemirror/commands";
export {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  CompletionContext,
  completionKeymap,
} from "@codemirror/autocomplete";
export type { Completion, CompletionResult } from "@codemirror/autocomplete";
export {
  closeSearchPanel,
  openSearchPanel,
  searchKeymap,
} from "@codemirror/search";
export {
  Decoration,
  drawSelection,
  dropCursor,
  EditorView,
  gutter,
  highlightSpecialChars,
  keymap,
  placeholder,
  runScopeHandlers,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from "@codemirror/view";
export type { DecorationSet, KeyBinding } from "@codemirror/view";
export {
  codeFolding,
  defaultHighlightStyle,
  defineLanguageFacet,
  foldAll,
  foldCode,
  foldedRanges,
  foldGutter,
  foldInside,
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
  toggleFold,
  unfoldAll,
  unfoldCode,
} from "@codemirror/language";
export {
  EditorSelection,
  EditorState,
  Range,
  SelectionRange,
  StateField,
  Text,
  Transaction,
} from "@codemirror/state";

export type {
  ChangeSpec,
  Compartment,
  Extension,
  StateCommand,
} from "@codemirror/state";

export { Fragment, h, render as preactRender } from "preact";
export type { ComponentChildren, FunctionalComponent } from "preact";

export type { FeatherProps } from "https://esm.sh/v99/preact-feather@4.2.1/dist/types";

export {
  useEffect,
  useReducer,
  useRef,
  useState,
} from "https://esm.sh/preact@10.11.1/hooks";

export * as featherIcons from "https://esm.sh/preact-feather@4.2.1?external=preact";

// Vim mode
export { getCM as vimGetCm, Vim, vim } from "@replit/codemirror-vim";
