// Local changes made to this file:
// * Disable HTML tags

import { Prec } from "@codemirror/state";
import { KeyBinding, keymap } from "../../../dep_common.ts";
import {
  Language,
  LanguageDescription,
  LanguageSupport,
} from "../../../dep_common.ts";
import {
  MarkdownExtension,
  MarkdownParser,
  parseCode,
} from "../../../dep_common.ts";
// import { html } from "@codemirror/lang-html";
import {
  commonmarkLanguage,
  getCodeParser,
  markdownLanguage,
  mkLang,
} from "./markdown.ts";
import {
  deleteMarkupBackward,
  insertNewlineContinueMarkup,
} from "./commands.ts";
export {
  commonmarkLanguage,
  deleteMarkupBackward,
  insertNewlineContinueMarkup,
  markdownLanguage,
};

/// A small keymap with Markdown-specific bindings. Binds Enter to
/// [`insertNewlineContinueMarkup`](#lang-markdown.insertNewlineContinueMarkup)
/// and Backspace to
/// [`deleteMarkupBackward`](#lang-markdown.deleteMarkupBackward).
export const markdownKeymap: readonly KeyBinding[] = [
  { key: "Enter", run: insertNewlineContinueMarkup },
  { key: "Backspace", run: deleteMarkupBackward },
];

// const htmlNoMatch = html({ matchClosingTags: false });

/// Markdown language support.
export function markdown(
  config: {
    /// When given, this language will be used by default to parse code
    /// blocks.
    defaultCodeLanguage?: Language | LanguageSupport;
    /// A source of language support for highlighting fenced code
    /// blocks. When it is an array, the parser will use
    /// [`LanguageDescription.matchLanguageName`](#language.LanguageDescription^matchLanguageName)
    /// with the fenced code info to find a matching language. When it
    /// is a function, will be called with the info string and may
    /// return a language or `LanguageDescription` object.
    codeLanguages?:
      | readonly LanguageDescription[]
      | ((info: string) => Language | LanguageDescription | null);
    /// Set this to false to disable installation of the Markdown
    /// [keymap](#lang-markdown.markdownKeymap).
    addKeymap?: boolean;
    /// Markdown parser
    /// [extensions](https://github.com/lezer-parser/markdown#user-content-markdownextension)
    /// to add to the parser.
    extensions?: MarkdownExtension;
    /// The base language to use. Defaults to
    /// [`commonmarkLanguage`](#lang-markdown.commonmarkLanguage).
    base?: Language;
  } = {},
) {
  let {
    codeLanguages,
    defaultCodeLanguage,
    addKeymap = true,
    base: { parser } = commonmarkLanguage,
  } = config;
  if (!(parser instanceof MarkdownParser)) {
    throw new RangeError(
      "Base parser provided to `markdown` should be a Markdown parser",
    );
  }
  let extensions = config.extensions ? [config.extensions] : [];
  // let support = [htmlNoMatch.support],
  let support = [],
    defaultCode;
  if (defaultCodeLanguage instanceof LanguageSupport) {
    support.push(defaultCodeLanguage.support);
    defaultCode = defaultCodeLanguage.language;
  } else if (defaultCodeLanguage) {
    defaultCode = defaultCodeLanguage;
  }
  let codeParser = codeLanguages || defaultCode
    ? getCodeParser(codeLanguages, defaultCode)
    : undefined;
  extensions.push(
    parseCode({ codeParser }), //, htmlParser: htmlNoMatch.language.parser })
  );
  if (addKeymap) support.push(Prec.high(keymap.of(markdownKeymap)));
  return new LanguageSupport(mkLang(parser.configure(extensions)), support);
}
