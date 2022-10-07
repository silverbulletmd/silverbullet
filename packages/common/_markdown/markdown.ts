import {
  defineLanguageFacet,
  foldNodeProp,
  indentNodeProp,
  Language,
  languageDataProp,
  LanguageDescription,
  ParseContext,
} from "../../../dep_common.ts";
import {
  baseParser,
  Emoji,
  GFM,
  MarkdownParser,
  Subscript,
  Superscript,
} from "../../../dep_common.ts";

const data = defineLanguageFacet({ block: { open: "<!--", close: "-->" } });

export const commonmark = baseParser.configure({
  props: [
    foldNodeProp.add((type) => {
      if (!type.is("Block") || type.is("Document")) return undefined;
      return (tree, state) => ({
        from: state.doc.lineAt(tree.from).to,
        to: tree.to,
      });
    }),
    indentNodeProp.add({
      Document: () => null,
    }),
    languageDataProp.add({
      Document: data,
    }),
  ],
});

export function mkLang(parser: MarkdownParser) {
  return new Language(data, parser);
}

/// Language support for strict CommonMark.
export const commonmarkLanguage = mkLang(commonmark);

const extended = commonmark.configure([GFM, Subscript, Superscript, Emoji]);

/// Language support for [GFM](https://github.github.com/gfm/) plus
/// subscript, superscript, and emoji syntax.
export const markdownLanguage = mkLang(extended);

export function getCodeParser(
  languages:
    | readonly LanguageDescription[]
    | ((info: string) => Language | LanguageDescription | null)
    | undefined,
  defaultLanguage?: Language,
) {
  return (info: string) => {
    if (info && languages) {
      let found = null;
      if (typeof languages == "function") found = languages(info);
      else found = LanguageDescription.matchLanguageName(languages, info, true);
      if (found instanceof LanguageDescription) {
        return found.support
          ? found.support.language.parser
          : ParseContext.getSkippingParser(found.load());
      } else if (found) return found.parser;
    }
    return defaultLanguage ? defaultLanguage.parser : null;
  };
}
