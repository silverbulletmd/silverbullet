import {
  BlockContext,
  Language,
  LeafBlock,
  LeafBlockParser,
  Line,
  markdown,
  MarkdownConfig,
  StreamLanguage,
  Strikethrough,
  styleTags,
  tags as t,
  yamlLanguage,
} from "../deps.ts";
import * as ct from "./customtags.ts";
import { TaskList } from "./extended_task.ts";
import {
  MDExt,
  mdExtensionStyleTags,
  mdExtensionSyntaxConfig,
} from "./markdown_ext.ts";

export const pageLinkRegex = /^\[\[([^\]\|]+)(\|([^\]]+))?\]\]/;

const WikiLink: MarkdownConfig = {
  defineNodes: [
    { name: "WikiLink", style: ct.WikiLinkTag },
    { name: "WikiLinkPage", style: ct.WikiLinkPageTag },
    { name: "WikiLinkAlias", style: ct.WikiLinkPageTag },
    { name: "WikiLinkMark", style: t.processingInstruction },
  ],
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
        const [fullMatch, page, pipePart, label] = match;
        const endPos = pos + fullMatch.length;
        let aliasElts: any[] = [];
        if (pipePart) {
          const pipeStartPos = pos + 2 + page.length;
          aliasElts = [
            cx.elt("WikiLinkMark", pipeStartPos, pipeStartPos + 1),
            cx.elt(
              "WikiLinkAlias",
              pipeStartPos + 1,
              pipeStartPos + 1 + label.length,
            ),
          ];
        }
        return cx.addElement(
          cx.elt("WikiLink", pos, endPos, [
            cx.elt("WikiLinkMark", pos, pos + 2),
            cx.elt("WikiLinkPage", pos + 2, pos + 2 + page.length),
            ...aliasElts,
            cx.elt("WikiLinkMark", endPos - 2, endPos),
          ]),
        );
      },
      after: "Emphasis",
    },
  ],
};

export const commandLinkRegex =
  /^\{\[([^\]\|]+)(\|([^\]]+))?\](\(([^\)]+)\))?\}/;

const CommandLink: MarkdownConfig = {
  defineNodes: [
    { name: "CommandLink", style: { "CommandLink/...": ct.CommandLinkTag } },
    { name: "CommandLinkName", style: ct.CommandLinkNameTag },
    { name: "CommandLinkAlias", style: ct.CommandLinkNameTag },
    { name: "CommandLinkArgs", style: ct.CommandLinkArgsTag },
    { name: "CommandLinkMark", style: t.processingInstruction },
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
        const [fullMatch, command, pipePart, label, argsPart, args] = match;
        const endPos = pos + fullMatch.length;

        let aliasElts: any[] = [];
        if (pipePart) {
          const pipeStartPos = pos + 2 + command.length;
          aliasElts = [
            cx.elt("CommandLinkMark", pipeStartPos, pipeStartPos + 1),
            cx.elt(
              "CommandLinkAlias",
              pipeStartPos + 1,
              pipeStartPos + 1 + label.length,
            ),
          ];
        }

        let argsElts: any[] = [];
        if (argsPart) {
          const argsStartPos = pos + 2 + command.length +
            (pipePart?.length ?? 0);
          argsElts = [
            cx.elt("CommandLinkMark", argsStartPos, argsStartPos + 2),
            cx.elt(
              "CommandLinkArgs",
              argsStartPos + 2,
              argsStartPos + 2 + args.length,
            ),
          ];
        }

        return cx.addElement(
          cx.elt("CommandLink", pos, endPos, [
            cx.elt("CommandLinkMark", pos, pos + 2),
            cx.elt("CommandLinkName", pos + 2, pos + 2 + command.length),
            ...aliasElts,
            ...argsElts,
            cx.elt("CommandLinkMark", endPos - 2, endPos),
          ]),
        );
      },
      after: "Emphasis",
    },
  ],
};

const HighlightDelim = { resolve: "Highlight", mark: "HighlightMark" };

export const Highlight: MarkdownConfig = {
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

export const attributeStartRegex = /^\[([\w\$]+)(::?\s*)/;

export const Attribute: MarkdownConfig = {
  defineNodes: [
    { name: "Attribute", style: { "Attribute/...": ct.AttributeTag } },
    { name: "AttributeName", style: ct.AttributeNameTag },
    { name: "AttributeValue", style: ct.AttributeValueTag },
    { name: "AttributeMark", style: t.processingInstruction },
    { name: "AttributeColon", style: t.processingInstruction },
  ],
  parseInline: [
    {
      name: "Attribute",
      parse(cx, next, pos) {
        let match: RegExpMatchArray | null;
        const textFromPos = cx.slice(pos, cx.end);
        if (
          next != 91 /* '[' */ ||
          // and match the whole thing
          !(match = attributeStartRegex.exec(textFromPos))
        ) {
          return -1;
        }
        const [fullMatch, attributeName, attributeColon] = match;
        let bracketNestingDepth = 1;
        let valueLength = fullMatch.length;
        loopLabel:
        for (; valueLength < textFromPos.length; valueLength++) {
          switch (textFromPos[valueLength]) {
            case "[":
              bracketNestingDepth++;
              break;
            case "]":
              bracketNestingDepth--;
              if (bracketNestingDepth === 0) {
                // Done!
                break loopLabel;
              }
              break;
          }
        }
        if (bracketNestingDepth !== 0) {
          console.log("Failed to parse attribute", fullMatch, textFromPos);
          return -1;
        }

        if (textFromPos[valueLength + 1] === "(") {
          console.log("Link", fullMatch, textFromPos);
          // This turns out to be a link, back out!
          return -1;
        }

        return cx.addElement(
          cx.elt("Attribute", pos, pos + valueLength + 1, [
            cx.elt("AttributeMark", pos, pos + 1), // [
            cx.elt("AttributeName", pos + 1, pos + 1 + attributeName.length),
            cx.elt(
              "AttributeColon",
              pos + 1 + attributeName.length,
              pos + 1 + attributeName.length + attributeColon.length,
            ),
            cx.elt(
              "AttributeValue",
              pos + 1 + attributeName.length + attributeColon.length,
              pos + valueLength,
            ),
            cx.elt("AttributeMark", pos + valueLength, pos + valueLength + 1), // [
          ]),
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

// Directive parser

const directiveStart = /^\s*<!--\s*#([a-z]+)\s*(.*?)-->\s*/;
const directiveEnd = /^\s*<!--\s*\/(.*?)-->\s*/;

import { parser as directiveParser } from "./parse-query.js";
import { parser as expressionParser } from "./parse-expression.js";
import { Table } from "./table_parser.ts";
import { foldNodeProp } from "@codemirror/language";
import { lezerToParseTree } from "./parse_tree.ts";

export const highlightingDirectiveParser = directiveParser.configure({
  props: [
    styleTags({
      "Name": t.variableName,
      "String": t.string,
      "Number": t.number,
      "PageRef": ct.WikiLinkTag,
      "where limit select render Order OrderKW and or as InKW each all":
        t.keyword,
    }),
  ],
});

export const Directive: MarkdownConfig = {
  defineNodes: [
    { name: "Directive", block: true, style: ct.DirectiveTag },
    { name: "DirectiveStart", style: ct.DirectiveStartTag, block: true },
    { name: "DirectiveEnd", style: ct.DirectiveEndTag },
    { name: "DirectiveBody", block: true },
  ],
  parseBlock: [{
    name: "Directive",
    parse: (cx, line: Line) => {
      const match = directiveStart.exec(line.text);
      if (!match) {
        return false;
      }

      // console.log("Parsing directive", line.text);

      const frontStart = cx.parsedPos;
      const [fullMatch, directive, arg] = match;
      const elts = [];
      if (directive === "query") {
        const queryParseTree = highlightingDirectiveParser.parse(arg);
        elts.push(cx.elt(
          "DirectiveStart",
          cx.parsedPos,
          cx.parsedPos + line.text.length + 1,
          [cx.elt(queryParseTree, frontStart + fullMatch.indexOf(arg))],
        ));
      } else if (directive === "eval") {
        const expressionParseTree = expressionParser.parse(arg);
        elts.push(cx.elt(
          "DirectiveStart",
          cx.parsedPos,
          cx.parsedPos + line.text.length + 1,
          [cx.elt(expressionParseTree, frontStart + fullMatch.indexOf(arg))],
        ));
      } else {
        elts.push(cx.elt(
          "DirectiveStart",
          cx.parsedPos,
          cx.parsedPos + line.text.length + 1,
        ));
      }

      // console.log("Query parse tree", queryParseTree.topNode);

      cx.nextLine();
      const startPos = cx.parsedPos;
      let endPos = startPos;
      let text = "";
      let lastPos = cx.parsedPos;
      let nesting = 0;
      while (true) {
        if (directiveEnd.exec(line.text) && nesting === 0) {
          break;
        }
        text += line.text + "\n";
        endPos += line.text.length + 1;
        if (directiveStart.exec(line.text)) {
          nesting++;
        }
        if (directiveEnd.exec(line.text)) {
          nesting--;
        }
        cx.nextLine();
        if (cx.parsedPos === lastPos) {
          // End of file, no progress made, there may be a better way to do this but :shrug:
          return false;
        }
        lastPos = cx.parsedPos;
      }
      const directiveBodyTree = cx.parser.parse(text);

      elts.push(
        cx.elt("DirectiveBody", startPos, endPos, [
          cx.elt(directiveBodyTree, startPos),
        ]),
      );
      endPos = cx.parsedPos + line.text.length;
      elts.push(cx.elt(
        "DirectiveEnd",
        cx.parsedPos,
        cx.parsedPos + line.text.length,
      ));
      cx.nextLine();
      cx.addElement(cx.elt("Directive", frontStart, endPos, elts));
      return true;
    },
    before: "HTMLBlock",
  }],
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
      Attribute,
      FrontMatter,
      Directive,
      TaskList,
      Comment,
      Highlight,
      Strikethrough,
      Table,
      ...mdExtensions.map(mdExtensionSyntaxConfig),
      {
        props: [
          foldNodeProp.add({
            // Don't fold at the list level
            BulletList: () => null,
            OrderedList: () => null,
            // Fold list items
            ListItem: (tree, state) => ({
              from: state.doc.lineAt(tree.from).to,
              to: tree.to,
            }),
          }),

          styleTags({
            Task: ct.TaskTag,
            TaskMark: ct.TaskMarkTag,
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
