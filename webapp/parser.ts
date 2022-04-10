import { styleTags, tags as t } from "@codemirror/highlight";
import { BlockContext, LeafBlock, LeafBlockParser, MarkdownConfig, parseCode, TaskList } from "@lezer/markdown";
import { commonmark, getCodeParser, mkLang } from "./markdown/markdown";
import * as ct from "./customtags";
import { LanguageDescription, LanguageSupport } from "@codemirror/language";
import { StreamLanguage } from "@codemirror/stream-parser";
import { yaml } from "@codemirror/legacy-modes/mode/yaml";
import { javascriptLanguage } from "@codemirror/lang-javascript";

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

const AtMention: MarkdownConfig = {
  defineNodes: ["AtMention"],
  parseInline: [
    {
      name: "AtMention",
      parse(cx, next, pos) {
        let match: RegExpMatchArray | null;
        if (
          next != 64 /* '@' */ ||
          !(match = /^[A-Za-z\.]+/.exec(cx.slice(pos + 1, cx.end)))
        ) {
          return -1;
        }
        return cx.addElement(
          cx.elt("AtMention", pos, pos + 1 + match[0].length)
        );
      },
      after: "Emphasis",
    },
  ],
};

export const urlRegexp =
  /^https?:\/\/[-a-zA-Z0-9@:%._\+~#=]{1,256}([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/;

const UnmarkedUrl: MarkdownConfig = {
  defineNodes: ["URL"],
  parseInline: [
    {
      name: "URL",
      parse(cx, next, pos) {
        let match: RegExpMatchArray | null;
        if (
          next != 104 /* 'h' */ ||
          !(match = urlRegexp.exec(cx.slice(pos, cx.end)))
        ) {
          return -1;
        }
        return cx.addElement(cx.elt("URL", pos, pos + match[0].length));
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

const TagLink: MarkdownConfig = {
  defineNodes: ["TagLink"],
  parseInline: [
    {
      name: "TagLink",
      parse(cx, next, pos) {
        let match: RegExpMatchArray | null;
        if (
          next != 35 /* '#' */ ||
          !(match = /^[A-Za-z\.]+/.exec(cx.slice(pos + 1, cx.end)))
        ) {
          return -1;
        }
        return cx.addElement(cx.elt("TagLink", pos, pos + 1 + match[0].length));
      },
      after: "Emphasis",
    },
  ],
};

const WikiMarkdown = commonmark.configure([
  WikiLink,
  AtMention,
  // TagLink,
  TaskList,
  UnmarkedUrl,
  Comment,
  parseCode({
    codeParser: getCodeParser([
      LanguageDescription.of({
        name: "yaml",
        support: new LanguageSupport(StreamLanguage.define(yaml)),
      }),
      LanguageDescription.of({
        name: "javascript",
        alias: ["js"],
        support: new LanguageSupport(javascriptLanguage),
      }),
    ]),
  }),
  {
    props: [
      styleTags({
        WikiLink: ct.WikiLinkTag,
        WikiLinkPage: ct.WikiLinkPageTag,
        AtMention: ct.MentionTag,
        TagLink: ct.TagTag,
        Task: ct.TaskTag,
        TaskMarker: ct.TaskMarkerTag,
        Url: t.url,
        Comment: ct.CommentTag,
      }),
    ],
  },
]);

export default mkLang(WikiMarkdown);
