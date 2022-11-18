import {
  BlockContext,
  Language,
  LeafBlock,
  LeafBlockParser,
  Line,
  markdown,
  MarkdownConfig,
  StreamLanguage,
  styleTags,
  Table,
  tags as t,
  TaskList,
  yamlLanguage,
} from "./deps.ts";
import * as ct from "./customtags.ts";
import {
  MDExt,
  mdExtensionStyleTags,
  mdExtensionSyntaxConfig,
} from "./markdown_ext.ts";

export const pageLinkRegex = /^\[\[([^\]]+)\]\]/;

const WikiLink: MarkdownConfig = {
  defineNodes: ["WikiLink", "WikiLinkPage", {
    name: "WikiLinkMark",
    style: t.processingInstruction,
  }],
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
        const endPos = pos + match[0].length;
        return cx.addElement(
          cx.elt("WikiLink", pos, endPos, [
            cx.elt("WikiLinkMark", pos, pos + 2),
            cx.elt("WikiLinkPage", pos + 2, endPos - 2),
            cx.elt("WikiLinkMark", endPos - 2, endPos),
          ]),
        );
      },
      after: "Emphasis",
    },
  ],
};

const commandLinkRegex = /^\{\[([^\]]+)\]\}/;

const CommandLink: MarkdownConfig = {
  defineNodes: [
    { name: "CommandLink", style: { "CommandLink/...": ct.CommandLinkTag } },
    { name: "CommandLinkName", style: ct.CommandLinkNameTag },
    {
      name: "CommandLinkMark",
      style: t.processingInstruction,
    },
  ],
  parseInline: [
    {
      name: "CommandLink",
      parse(cx, next, pos) {
        let match: RegExpMatchArray | null;
        if (
          next != 123 /* '{' */ ||
          !(match = commandLinkRegex.exec(cx.slice(pos, cx.end)))
        ) {
          return -1;
        }
        const endPos = pos + match[0].length;
        return cx.addElement(
          cx.elt("CommandLink", pos, endPos, [
            cx.elt("CommandLinkMark", pos, pos + 2),
            cx.elt("CommandLinkName", pos + 2, endPos - 2),
            cx.elt("CommandLinkMark", endPos - 2, endPos),
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
      leaf(_cx, leaf) {
        return /^%%\s/.test(leaf.content) ? new CommentParser() : null;
      },
      after: "SetextHeading",
    },
  ],
};

// FrontMatter parser

const yamlLang = StreamLanguage.define(yamlLanguage);

export const FrontMatter: MarkdownConfig = {
  defineNodes: [
    { name: "FrontMatter", block: true },
    { name: "FrontMatterMarker" },
    { name: "FrontMatterCode" },
  ],
  parseBlock: [{
    name: "FrontMatter",
    parse: (cx, line: Line) => {
      if (cx.parsedPos !== 0) {
        return false;
      }
      if (line.text !== "---") {
        return false;
      }
      const frontStart = cx.parsedPos;
      const elts = [
        cx.elt(
          "FrontMatterMarker",
          cx.parsedPos,
          cx.parsedPos + line.text.length + 1,
        ),
      ];
      cx.nextLine();
      const startPos = cx.parsedPos;
      let endPos = startPos;
      let text = "";
      let lastPos = cx.parsedPos;
      do {
        text += line.text + "\n";
        endPos += line.text.length + 1;
        cx.nextLine();
        if (cx.parsedPos === lastPos) {
          // End of file, no progress made, there may be a better way to do this but :shrug:
          return false;
        }
        lastPos = cx.parsedPos;
      } while (line.text !== "---");
      const yamlTree = yamlLang.parser.parse(text);

      elts.push(
        cx.elt("FrontMatterCode", startPos, endPos, [
          cx.elt(yamlTree, startPos),
        ]),
      );
      endPos = cx.parsedPos + line.text.length;
      elts.push(cx.elt(
        "FrontMatterMarker",
        cx.parsedPos,
        cx.parsedPos + line.text.length,
      ));
      cx.nextLine();
      cx.addElement(cx.elt("FrontMatter", frontStart, endPos, elts));
      return true;
    },
    before: "HorizontalRule",
  }],
};

export default function buildMarkdown(mdExtensions: MDExt[]): Language {
  return markdown({
    extensions: [
      WikiLink,
      CommandLink,
      FrontMatter,
      TaskList,
      Comment,
      Strikethrough,
      Table,
      ...mdExtensions.map(mdExtensionSyntaxConfig),

      {
        props: [
          styleTags({
            WikiLink: ct.WikiLinkTag,
            WikiLinkPage: ct.WikiLinkPageTag,
            // CommandLink: ct.CommandLinkTag,
            // CommandLinkName: ct.CommandLinkNameTag,
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
