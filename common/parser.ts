import {
  BlockContext,
  Language,
  LanguageDescription,
  LanguageSupport,
  LeafBlock,
  LeafBlockParser,
  markdown,
  MarkdownConfig,
  parseCode,
  styleTags,
  Table,
  tags as t,
  TaskList,
} from "./deps.ts";
import * as ct from "./customtags.ts";
import {
  MDExt,
  mdExtensionStyleTags,
  mdExtensionSyntaxConfig,
} from "./markdown_ext.ts";

export const pageLinkRegex = /^\[\[([^\]]+)\]\]/;

const WikiLink: MarkdownConfig = {
  defineNodes: ["WikiLink", "WikiLinkPage"],
  parseInline: [
    {
      name: "WikiLink",
      parse(cx, next, pos) {
        let match: RegExpMatchArray | null;
        if (
          next != 91 /* '[' */ ||
          !(match = pageLinkRegex.exec(cx.slice(pos, cx.end)))
        ) {
          return -1;
        }
        return cx.addElement(
          cx.elt("WikiLink", pos, pos + match[0].length, [
            cx.elt("WikiLinkPage", pos + 2, pos + match[0].length - 2),
          ]),
        );
      },
      after: "Emphasis",
    },
  ],
};

const HighlightDelim = { resolve: "Highlight", mark: "HighlightMark" };

export const Strikethrough: MarkdownConfig = {
  defineNodes: [
    {
      name: "Highlight",
      style: { "Highlight/...": ct.Highlight },
    },
    {
      name: "HighlightMark",
      style: t.processingInstruction,
    },
  ],
  parseInline: [
    {
      name: "Highlight",
      parse(cx, next, pos) {
        if (next != 61 /* '=' */ || cx.char(pos + 1) != 61) return -1;
        return cx.addDelimiter(HighlightDelim, pos, pos + 2, true, true);
      },
      after: "Emphasis",
    },
  ],
};

class CommentParser implements LeafBlockParser {
  nextLine() {
    return false;
  }

  finish(cx: BlockContext, leaf: LeafBlock) {
    cx.addLeafElement(
      leaf,
      cx.elt("Comment", leaf.start, leaf.start + leaf.content.length, [
        // cx.elt("CommentMarker", leaf.start, leaf.start + 3),
        ...cx.parser.parseInline(leaf.content.slice(3), leaf.start + 3),
      ]),
    );
    return true;
  }
}
export const Comment: MarkdownConfig = {
  defineNodes: [{ name: "Comment", block: true }],
  parseBlock: [
    {
      name: "Comment",
      leaf(cx, leaf) {
        return /^%%\s/.test(leaf.content) ? new CommentParser() : null;
      },
      after: "SetextHeading",
    },
  ],
};

export default function buildMarkdown(mdExtensions: MDExt[]): Language {
  return markdown({
    extensions: [
      WikiLink,
      TaskList,
      Comment,
      Strikethrough,
      Table,
      ...mdExtensions.map(mdExtensionSyntaxConfig),
      // parseCode({
      //   codeParser: getCodeParser([
      //     LanguageDescription.of({
      //       name: "yaml",
      //       alias: ["meta", "data"],
      //       support: new LanguageSupport(StreamLanguage.define(yaml)),
      //     }),
      //     LanguageDescription.of({
      //       name: "javascript",
      //       alias: ["js"],
      //       support: new LanguageSupport(javascriptLanguage),
      //     }),
      //     LanguageDescription.of({
      //       name: "typescript",
      //       alias: ["ts"],
      //       support: new LanguageSupport(typescriptLanguage),
      //     }),
      //   ]),
      // }),
      {
        props: [
          styleTags({
            WikiLink: ct.WikiLinkTag,
            WikiLinkPage: ct.WikiLinkPageTag,
            Task: ct.TaskTag,
            TaskMarker: ct.TaskMarkerTag,
            Comment: ct.CommentTag,
            "TableDelimiter SubscriptMark SuperscriptMark StrikethroughMark":
              t.processingInstruction,
            "TableHeader/...": t.heading,
            TableCell: t.content,
            CodeInfo: ct.CodeInfoTag,
            HorizontalRule: ct.HorizontalRuleTag,
          }),
          ...mdExtensions.map((mdExt) =>
            styleTags(mdExtensionStyleTags(mdExt))
          ),
        ],
      },
    ],
  }).language;
}
