import { styleTags, tags as t } from "@codemirror/highlight";
import {
  MarkdownConfig,
  TaskList,
  BlockContext,
  LeafBlock,
  LeafBlockParser,
} from "@lezer/markdown";
import { commonmark, mkLang } from "./markdown/markdown";
import * as ct from "./customtags";
import { pageLinkRegex } from "./constant";

const pageLinkRegexPrefix = new RegExp(
  "^" + pageLinkRegex.toString().slice(1, -1)
);

const WikiLink: MarkdownConfig = {
  defineNodes: ["WikiLink", "WikiLinkPage"],
  parseInline: [
    {
      name: "WikiLink",
      parse(cx, next, pos) {
        let match: RegExpMatchArray | null;
        if (
          next != 91 /* '[' */ ||
          !(match = pageLinkRegexPrefix.exec(cx.slice(pos, cx.end)))
        ) {
          return -1;
        }
        return cx.addElement(
          cx.elt("WikiLink", pos, pos + match[0].length + 1, [
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

const urlRegexp =
  /^https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/;

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
  TagLink,
  TaskList,
  UnmarkedUrl,
  Comment,
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
        // CommentMarker: ct.CommentMarkerTag,
      }),
    ],
  },
]);

export default mkLang(WikiMarkdown);
