import { styleTags, tags as t } from "@codemirror/highlight";
import {
  BlockContext,
  LeafBlock,
  LeafBlockParser,
  MarkdownConfig,
  parseCode,
  Table,
  TaskList,
} from "@lezer/markdown";
import { commonmark, getCodeParser, mkLang } from "./markdown/markdown";
import * as ct from "./customtags";
import {
  Language,
  LanguageDescription,
  LanguageSupport,
} from "@codemirror/language";
import { StreamLanguage } from "@codemirror/stream-parser";
import { yaml } from "@codemirror/legacy-modes/mode/yaml";
import {
  javascriptLanguage,
  typescriptLanguage,
} from "@codemirror/lang-javascript";
import {
  MDExt,
  mdExtensionStyleTags,
  mdExtensionSyntaxConfig,
} from "./markdown_ext";

export const pageLinkRegex = /^\[\[([^\]]+)\]\]/;

// const pageLinkRegexPrefix = new RegExp(
//   "^" + pageLinkRegex.toString().slice(1, -1)
// );

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
          ])
        );
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
      ])
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
  return mkLang(
    commonmark.configure([
      WikiLink,
      TaskList,
      Comment,
      Table,
      ...mdExtensions.map(mdExtensionSyntaxConfig),
      parseCode({
        codeParser: getCodeParser([
          LanguageDescription.of({
            name: "yaml",
            alias: ["meta", "data"],
            support: new LanguageSupport(StreamLanguage.define(yaml)),
          }),
          LanguageDescription.of({
            name: "javascript",
            alias: ["js"],
            support: new LanguageSupport(javascriptLanguage),
          }),
          LanguageDescription.of({
            name: "typescript",
            alias: ["ts"],
            support: new LanguageSupport(typescriptLanguage),
          }),
        ]),
      }),
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
          }),
          ...mdExtensions.map((mdExt) =>
            styleTags(mdExtensionStyleTags(mdExt))
          ),
        ],
      },
    ])
  );
}
