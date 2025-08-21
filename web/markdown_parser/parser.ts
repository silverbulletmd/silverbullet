import { yaml as yamlLanguage } from "@codemirror/legacy-modes/mode/yaml";
import { styleTags, type Tag, tags as t } from "@lezer/highlight";
import {
  type Line,
  type MarkdownConfig,
  Strikethrough,
  Subscript,
  Superscript,
} from "@lezer/markdown";
import { markdown } from "@codemirror/lang-markdown";
import { foldNodeProp, StreamLanguage } from "@codemirror/language";
import * as ct from "./customtags.ts";
import { NakedURLTag } from "./customtags.ts";
import { TaskList } from "./extended_task.ts";
import { Table } from "./table_parser.ts";
import { pWikiLinkRegex, tagRegex } from "./constants.ts";
import { parse } from "./parse_tree.ts";
import type { ParseTree } from "@silverbulletmd/silverbullet/lib/tree";
import { luaLanguage } from "../../lib/space_lua/parse.ts";

const WikiLink: MarkdownConfig = {
  defineNodes: [
    { name: "WikiLink" },
    { name: "WikiLinkPage", style: ct.WikiLinkPartTag },
    { name: "WikiLinkAlias", style: ct.WikiLinkPartTag },
    { name: "WikiLinkDimensions", style: ct.WikiLinkPartTag },
    { name: "WikiLinkMark", style: t.processingInstruction },
  ],
  parseInline: [
    {
      name: "WikiLink",
      parse(cx, next, pos) {
        // Do a preliminary check for performance
        if (next != 91 /* '[' */ && next != 33 /* '!' */) {
          return -1;
        }

        pWikiLinkRegex.lastIndex = 0;
        const match = pWikiLinkRegex.exec(cx.slice(pos, cx.end));
        if (!match || !match.groups) {
          return -1;
        }

        //const [fullMatch, firstMark, page, alias, _lastMark] = match;
        const { leadingTrivia, stringRef, alias } = match.groups;
        const endPos = pos + match[0].length;
        let aliasElts: any[] = [];
        if (alias) {
          const pipeStartPos = pos + leadingTrivia.length + stringRef.length;
          aliasElts = [
            cx.elt("WikiLinkMark", pipeStartPos, pipeStartPos + 1),
            cx.elt(
              "WikiLinkAlias",
              pipeStartPos + 1,
              pipeStartPos + 1 + alias.length,
            ),
          ];
        }

        let allElts = cx.elt("WikiLink", pos, endPos, [
          cx.elt("WikiLinkMark", pos, pos + leadingTrivia.length),
          cx.elt(
            "WikiLinkPage",
            pos + leadingTrivia.length,
            pos + leadingTrivia.length + stringRef.length,
          ),
          ...aliasElts,
          cx.elt("WikiLinkMark", endPos - 2, endPos),
        ]);

        // If inline image
        if (next == 33) {
          allElts = cx.elt("Image", pos, endPos, [allElts]);
        }

        return cx.addElement(allElts);
      },
      after: "Emphasis",
    },
  ],
};

const LuaDirectives: MarkdownConfig = {
  defineNodes: [
    { name: "LuaDirective" },
    { name: "LuaExpressionDirective" },
    { name: "LuaDirectiveMark", style: ct.DirectiveMarkTag },
  ],
  parseInline: [
    {
      name: "LuaDirective",
      parse(cx, next, pos) {
        const textFromPos = cx.slice(pos, cx.end);
        if (
          next !== 36 /* '$' */ ||
          cx.slice(pos, pos + 2) !== "${"
        ) {
          return -1;
        }

        let bracketNestingDepth = 0;
        let valueLength = 0;
        // We need to ensure balanced { and } pairs
        loopLabel:
        for (; valueLength < textFromPos.length; valueLength++) {
          switch (textFromPos[valueLength]) {
            case "{":
              bracketNestingDepth++;
              break;
            case "}":
              bracketNestingDepth--;
              if (bracketNestingDepth === 0) {
                // Done!
                break loopLabel;
              }
              break;
          }
        }
        if (bracketNestingDepth !== 0) {
          return -1;
        }

        const bodyText = textFromPos.slice(2, valueLength);
        const endPos = pos + valueLength + 1;

        // Let's parse as an expression
        const parsedExpression = luaLanguage.parser.parse(`_(${bodyText})`);

        // If bodyText starts with whitespace, we need to offset this later
        const whiteSpaceOffset = bodyText.match(/^\s*/)?.[0].length ?? 0;

        const node = parsedExpression.resolveInner(2, 0).firstChild?.nextSibling
          ?.nextSibling;

        if (!node) {
          return -1;
        }
        const bodyEl = cx.elt(
          "LuaExpressionDirective",
          pos + 2,
          endPos - 1,
          [cx.elt(node.toTree()!, pos + 2 + whiteSpaceOffset)],
        );

        return cx.addElement(
          cx.elt("LuaDirective", pos, endPos, [
            cx.elt("LuaDirectiveMark", pos, pos + 2),
            bodyEl,
            cx.elt("LuaDirectiveMark", endPos - 1, endPos),
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

type RegexParserExtension = {
  // unicode char code for efficiency .charCodeAt(0)
  firstCharCode: number;
  regex: RegExp;
  nodeType: string;
  tag: Tag;
  className?: string;
};

function regexParser({
  regex,
  firstCharCode,
  nodeType,
}: RegexParserExtension): MarkdownConfig {
  return {
    defineNodes: [nodeType],
    parseInline: [
      {
        name: nodeType,
        parse(cx, next, pos) {
          if (firstCharCode !== next) {
            return -1;
          }
          const match = regex.exec(cx.slice(pos, cx.end));
          if (!match) {
            return -1;
          }
          return cx.addElement(cx.elt(nodeType, pos, pos + match[0].length));
        },
      },
    ],
  };
}

const NakedURL = regexParser(
  {
    firstCharCode: 104, // h
    regex:
      /(^https?:\/\/([-a-zA-Z0-9@:%_\+~#=]|(?:[.](?!(\s|$)))){1,256})(([-a-zA-Z0-9(@:%_\+~#?&=\/]|(?:[.,:;)](?!(\s|$))))*)/,
    nodeType: "NakedURL",
    className: "sb-naked-url",
    tag: NakedURLTag,
  },
);

const Hashtag = regexParser({
  firstCharCode: 35, // #
  regex: new RegExp(`^${tagRegex.source}`),
  nodeType: "Hashtag",
  className: "sb-hashtag-text",
  tag: ct.HashtagTag,
});

const TaskDeadline = regexParser({
  firstCharCode: 55357, // 📅
  regex: /^📅\s*\d{4}\-\d{2}\-\d{2}/,
  className: "sb-task-deadline",
  nodeType: "DeadlineDate",
  tag: ct.TaskDeadlineTag,
});

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

export const extendedMarkdownLanguage = markdown({
  extensions: [
    WikiLink,
    Attribute,
    FrontMatter,
    TaskList,
    Highlight,
    LuaDirectives,
    Strikethrough,
    Table,
    NakedURL,
    Hashtag,
    TaskDeadline,
    Superscript,
    Subscript,
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
          // Fold frontmatter
          FrontMatter: (tree) => ({
            from: tree.from,
            to: tree.to,
          }),
        }),

        styleTags({
          Task: ct.TaskTag,
          TaskMark: ct.TaskMarkTag,
          Comment: ct.CommentTag,
          "Subscript": ct.SubscriptTag,
          "Superscript": ct.SuperscriptTag,
          "TableDelimiter StrikethroughMark": t.processingInstruction,
          "TableHeader/...": t.heading,
          TableCell: t.content,
          CodeInfo: ct.CodeInfoTag,
          HorizontalRule: ct.HorizontalRuleTag,
          Hashtag: ct.HashtagTag,
          NakedURL: ct.NakedURLTag,
          DeadlineDate: ct.TaskDeadlineTag,
          NamedAnchor: ct.NamedAnchorTag,
        }),
      ],
    },
  ],
}).language;

export function parseMarkdown(text: string): ParseTree {
  return parse(extendedMarkdownLanguage, text);
}
