import {Prec} from "@codemirror/state"
import {KeyBinding, keymap} from "@codemirror/view"
import {Language, LanguageSupport, LanguageDescription} from "@codemirror/language"
import {MarkdownExtension, MarkdownParser, parseCode} from "@lezer/markdown"
import {html} from "@codemirror/lang-html"
import {commonmarkLanguage, markdownLanguage, mkLang, getCodeParser} from "./markdown"
import {insertNewlineContinueMarkup, deleteMarkupBackward} from "./commands"
export {commonmarkLanguage, markdownLanguage, insertNewlineContinueMarkup, deleteMarkupBackward}

/// A small keymap with Markdown-specific bindings. Binds Enter to
/// [`insertNewlineContinueMarkup`](#lang-markdown.insertNewlineContinueMarkup)
/// and Backspace to
/// [`deleteMarkupBackward`](#lang-markdown.deleteMarkupBackward).
export const markdownKeymap: readonly KeyBinding[] = [
  {key: "Enter", run: insertNewlineContinueMarkup},
  {key: "Backspace", run: deleteMarkupBackward}
]

const htmlNoMatch = html({matchClosingTags: false})

/// Markdown language support.
export function markdown(config: {
  /// When given, this language will be used by default to parse code
  /// blocks.
  defaultCodeLanguage?: Language | LanguageSupport,
  /// A collection of language descriptions to search through for a
  /// matching language (with
  /// [`LanguageDescription.matchLanguageName`](#language.LanguageDescription^matchLanguageName))
  /// when a fenced code block has an info string.
  codeLanguages?: readonly LanguageDescription[],
  /// Set this to false to disable installation of the Markdown
  /// [keymap](#lang-markdown.markdownKeymap).
  addKeymap?: boolean,
  /// Markdown parser
  /// [extensions](https://github.com/lezer-parser/markdown#user-content-markdownextension)
  /// to add to the parser.
  extensions?: MarkdownExtension,
  /// The base language to use. Defaults to
  /// [`commonmarkLanguage`](#lang-markdown.commonmarkLanguage).
  base?: Language
} = {}) {
  let {codeLanguages, defaultCodeLanguage, addKeymap = true, base: {parser} = commonmarkLanguage} = config
  if (!(parser instanceof MarkdownParser)) throw new RangeError("Base parser provided to `markdown` should be a Markdown parser")
  let extensions = config.extensions ? [config.extensions] : []
  let support = [htmlNoMatch.support], defaultCode
  if (defaultCodeLanguage instanceof LanguageSupport) {
    support.push(defaultCodeLanguage.support)
    defaultCode = defaultCodeLanguage.language
  } else if (defaultCodeLanguage) {
    defaultCode = defaultCodeLanguage
  }
  let codeParser = codeLanguages || defaultCode ? getCodeParser(codeLanguages || [], defaultCode) : undefined
  extensions.push(parseCode({codeParser, htmlParser: htmlNoMatch.language.parser}))
  if (addKeymap) support.push(Prec.high(keymap.of(markdownKeymap)))
  return new LanguageSupport(mkLang(parser.configure(extensions)), support)
}
