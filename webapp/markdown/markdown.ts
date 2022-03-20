import {
    Language, defineLanguageFacet, languageDataProp, foldNodeProp, indentNodeProp,
    LanguageDescription, ParseContext
} from "@codemirror/language"
import {styleTags, tags as t} from "@codemirror/highlight"
import {parser as baseParser, MarkdownParser, GFM, Subscript, Superscript, Emoji, MarkdownConfig} from "@lezer/markdown"

const data = defineLanguageFacet({block: {open: "<!--", close: "-->"}})

export const commonmark = baseParser.configure({
    props: [
        styleTags({
            "Blockquote/...": t.quote,
            HorizontalRule: t.contentSeparator,
            "ATXHeading1/... SetextHeading1/...": t.heading1,
            "ATXHeading2/... SetextHeading2/...": t.heading2,
            "ATXHeading3/...": t.heading3,
            "ATXHeading4/...": t.heading4,
            "ATXHeading5/...": t.heading5,
            "ATXHeading6/...": t.heading6,
            "Comment CommentBlock": t.comment,
            Escape: t.escape,
            Entity: t.character,
            "Emphasis/...": t.emphasis,
            "StrongEmphasis/...": t.strong,
            "Link/... Image/...": t.link,
            "OrderedList/... BulletList/...": t.list,

            // "CodeBlock/... FencedCode/...": t.blockComment,
            "InlineCode CodeText": t.monospace,
            URL: t.url,
            "HeaderMark HardBreak QuoteMark ListMark LinkMark EmphasisMark CodeMark": t.processingInstruction,
            "CodeInfo LinkLabel": t.labelName,
            LinkTitle: t.string,
            Paragraph: t.content
        }),
        foldNodeProp.add(type => {
            if (!type.is("Block") || type.is("Document")) return undefined
            return (tree, state) => ({from: state.doc.lineAt(tree.from).to, to: tree.to})
        }),
        indentNodeProp.add({
            Document: () => null
        }),
        languageDataProp.add({
            Document: data
        })
    ]
})

export function mkLang(parser: MarkdownParser) {
    return new Language(data, parser, parser.nodeSet.types.find(t => t.name == "Document")!)
}

/// Language support for strict CommonMark.
export const commonmarkLanguage = mkLang(commonmark)

const extended = commonmark.configure([GFM, Subscript, Superscript, Emoji, {
    props: [
        styleTags({
            "TableDelimiter SubscriptMark SuperscriptMark StrikethroughMark": t.processingInstruction,
            "TableHeader/...": t.heading,
            "Strikethrough/...": t.strikethrough,
            TaskMarker: t.atom,
            Task: t.list,
            Emoji: t.character,
            "Subscript Superscript": t.special(t.content),
            TableCell: t.content
        })
    ]
}])

/// Language support for [GFM](https://github.github.com/gfm/) plus
/// subscript, superscript, and emoji syntax.
export const markdownLanguage = mkLang(extended)

export function getCodeParser(languages: readonly LanguageDescription[],
                              defaultLanguage?: Language) {
    return (info: string) => {
        let found = info && LanguageDescription.matchLanguageName(languages, info, true)
        if (!found) return defaultLanguage ? defaultLanguage.parser : null
        if (found.support) return found.support.language.parser
        return ParseContext.getSkippingParser(found.load())
    }
}
