import { Prec } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { LanguageSupport } from "@codemirror/language";
import { MarkdownParser, parseCode } from "@lezer/markdown";
import { html } from "@codemirror/lang-html";
import { commonmarkLanguage, markdownLanguage, mkLang, getCodeParser } from "./markdown";
import { insertNewlineContinueMarkup, deleteMarkupBackward } from "./commands";
export { commonmarkLanguage, markdownLanguage, insertNewlineContinueMarkup, deleteMarkupBackward };
/// A small keymap with Markdown-specific bindings. Binds Enter to
/// [`insertNewlineContinueMarkup`](#lang-markdown.insertNewlineContinueMarkup)
/// and Backspace to
/// [`deleteMarkupBackward`](#lang-markdown.deleteMarkupBackward).
export const markdownKeymap = [
    { key: "Enter", run: insertNewlineContinueMarkup },
    { key: "Backspace", run: deleteMarkupBackward }
];
const htmlNoMatch = html({ matchClosingTags: false });
/// Markdown language support.
export function markdown(config = {}) {
    let { codeLanguages, defaultCodeLanguage, addKeymap = true, base: { parser } = commonmarkLanguage } = config;
    if (!(parser instanceof MarkdownParser))
        throw new RangeError("Base parser provided to `markdown` should be a Markdown parser");
    let extensions = config.extensions ? [config.extensions] : [];
    let support = [htmlNoMatch.support], defaultCode;
    if (defaultCodeLanguage instanceof LanguageSupport) {
        support.push(defaultCodeLanguage.support);
        defaultCode = defaultCodeLanguage.language;
    }
    else if (defaultCodeLanguage) {
        defaultCode = defaultCodeLanguage;
    }
    let codeParser = codeLanguages || defaultCode ? getCodeParser(codeLanguages || [], defaultCode) : undefined;
    extensions.push(parseCode({ codeParser, htmlParser: htmlNoMatch.language.parser }));
    if (addKeymap)
        support.push(Prec.high(keymap.of(markdownKeymap)));
    return new LanguageSupport(mkLang(parser.configure(extensions)), support);
}
