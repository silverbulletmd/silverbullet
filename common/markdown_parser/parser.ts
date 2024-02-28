import { commandLinkRegex } from "../command.ts";
import { yaml as yamlLanguage } from "@codemirror/legacy-modes/mode/yaml?external=@codemirror/language&target=es2022";
import { styleTags, Tag, tags as t } from "@lezer/highlight";
import {
  BlockContext,
  LeafBlock,
  LeafBlockParser,
  Line,
  MarkdownConfig,
  Strikethrough,
} from "@lezer/markdown";
import { markdown } from "@codemirror/lang-markdown";
import { StreamLanguage } from "@codemirror/language";
import * as ct from "./customtags.ts";
import { NakedURLTag } from "./customtags.ts";
import { TaskList } from "./extended_task.ts";

export const pageLinkRegex = /^\[\[([^\]\|]+)(\|([^\]]+))?\]\]/;

export const tagRegex =
  /#[^\d\s!@#$%^&*(),.?":{}|<>\\][^\s!@#$%^&*(),.?":{}|<>\\]*/;

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

const TemplateDirective: MarkdownConfig = {
  defineNodes: [
    { name: "TemplateDirective" },
    { name: "TemplateExpressionDirective" },
    { name: "TemplateIfStartDirective", style: ct.DirectiveTag },
    { name: "TemplateEachStartDirective", style: ct.DirectiveTag },
    { name: "TemplateEachVarStartDirective", style: ct.DirectiveTag },
    { name: "TemplateLetStartDirective", style: ct.DirectiveTag },
    { name: "TemplateIfEndDirective", style: ct.DirectiveTag },
    { name: "TemplateEachEndDirective", style: ct.DirectiveTag },
    { name: "TemplateLetEndDirective", style: ct.DirectiveTag },
    { name: "TemplateVar", style: t.variableName },
    { name: "TemplateDirectiveMark", style: ct.DirectiveMarkTag },
  ],
  parseInline: [
    {
      name: "TemplateDirective",
      parse(cx, next, pos) {
        const textFromPos = cx.slice(pos, cx.end);
        if (
          next != 123 /* '{' */ ||
          cx.slice(pos, pos + 2) !== "{{"
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

        const bodyText = textFromPos.slice(2, valueLength - 1);
        // console.log("Body text", bodyText);

        const endPos = pos + valueLength + 1;
        let bodyEl: any;

        // Is this an let block directive?
        const openLetBlockMatch = /^(\s*#let\s*)(@\w+)(\s*=\s*)(.+)$/s.exec(
          bodyText,
        );
        if (openLetBlockMatch) {
          const [_, directiveStart, varName, eq, expr] = openLetBlockMatch;
          const parsedExpression = highlightingExpressionParser.parse(
            expr,
          );
          bodyEl = cx.elt(
            "TemplateLetStartDirective",
            pos + 2,
            endPos - 2,
            [
              cx.elt(
                "TemplateVar",
                pos + 2 + directiveStart.length,
                pos + 2 + directiveStart.length + varName.length,
              ),
              cx.elt(
                parsedExpression,
                pos + 2 + directiveStart.length + varName.length + eq.length,
              ),
            ],
          );
        }

        if (!bodyEl) {
          // Is this an #each @p = block directive?
          const openEachVariableBlockMatch =
            /^(\s*#each\s*)(@\w+)(\s+in\s+)(.+)$/s.exec(
              bodyText,
            );
          if (openEachVariableBlockMatch) {
            const [_, directiveStart, varName, eq, expr] =
              openEachVariableBlockMatch;
            const parsedExpression = highlightingExpressionParser.parse(
              expr,
            );
            bodyEl = cx.elt(
              "TemplateEachVarStartDirective",
              pos + 2,
              endPos - 2,
              [
                cx.elt(
                  "TemplateVar",
                  pos + 2 + directiveStart.length,
                  pos + 2 + directiveStart.length + varName.length,
                ),
                cx.elt(
                  parsedExpression,
                  pos + 2 + directiveStart.length + varName.length + eq.length,
                ),
              ],
            );
          }
        }
        if (!bodyEl) {
          // Is this an open block directive?
          const openBlockMatch = /^(\s*#(if|each)\s*)(.+)$/s.exec(bodyText);
          if (openBlockMatch) {
            const [_, directiveStart, directiveType, directiveBody] =
              openBlockMatch;
            const parsedExpression = highlightingExpressionParser.parse(
              directiveBody,
            );
            bodyEl = cx.elt(
              directiveType === "if"
                ? "TemplateIfStartDirective"
                : "TemplateEachStartDirective",
              pos + 2,
              endPos - 2,
              [cx.elt(parsedExpression, pos + 2 + directiveStart.length)],
            );
          }
        }

        if (!bodyEl) {
          // Is this a directive close?
          const closeBlockMatch = /^\s*\/(if|each|let)/.exec(bodyText);

          if (closeBlockMatch) {
            const [_, directiveType] = closeBlockMatch;
            const upCaseDirectiveType = directiveType[0].toUpperCase() +
              directiveType.slice(1);
            bodyEl = cx.elt(
              `Template${upCaseDirectiveType}EndDirective`,
              pos + 2,
              endPos - 2,
            );
          }
        }

        if (!bodyEl) {
          // Let's parse as an expression
          const parsedExpression = highlightingExpressionParser.parse(bodyText);
          bodyEl = cx.elt(
            "TemplateExpressionDirective",
            pos + 2,
            endPos - 2,
            [cx.elt(parsedExpression, pos + 2)],
          );
        }

        return cx.addElement(
          cx.elt("TemplateDirective", pos, endPos, [
            cx.elt("TemplateDirectiveMark", pos, pos + 2),
            bodyEl!,
            cx.elt("TemplateDirectiveMark", endPos - 2, endPos),
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

import { parser as queryParser } from "./parse-query.js";

const expressionStyleTags = styleTags({
  Identifier: t.variableName,
  TagIdentifier: t.variableName,
  GlobalIdentifier: t.variableName,
  String: t.string,
  Number: t.number,
  PageRef: ct.WikiLinkTag,
  BinExpression: t.operator,
  TernaryExpression: t.operator,
  Regex: t.regexp,
  "where limit select render Order OrderKW and or null as InKW NotKW BooleanKW each all":
    t.keyword,
});

export const highlightingQueryParser = queryParser.configure({
  props: [
    expressionStyleTags,
  ],
});

import { parser as expressionParser } from "./parse-expression.js";

export const highlightingExpressionParser = expressionParser.configure({
  props: [expressionStyleTags],
});

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
      /^https?:\/\/[-a-zA-Z0-9@:%._\+~#=]{1,256}([-a-zA-Z0-9()@:%_\+.~#?&=\/]*)/,
    nodeType: "NakedURL",
    className: "sb-naked-url",
    tag: NakedURLTag,
  },
);

const Hashtag = regexParser(
  {
    firstCharCode: 35, // #
    regex: new RegExp(`^${tagRegex.source}`),
    nodeType: "Hashtag",
    className: "sb-hashtag",
    tag: ct.HashtagTag,
  },
);

const TaskDeadline = regexParser({
  firstCharCode: 55357, // 📅
  regex: /^📅\s*\d{4}\-\d{2}\-\d{2}/,
  className: "sb-task-deadline",
  nodeType: "DeadlineDate",
  tag: ct.TaskDeadlineTag,
});

const NamedAnchor = regexParser({
  firstCharCode: 36, // $
  regex: /^\$[a-zA-Z\.\-\/]+[\w\.\-\/]*/,
  className: "sb-named-anchor",
  nodeType: "NamedAnchor",
  tag: ct.NamedAnchorTag,
});

import { Table } from "./table_parser.ts";
import { foldNodeProp } from "@codemirror/language";

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
    CommandLink,
    Attribute,
    FrontMatter,
    TaskList,
    Comment,
    Highlight,
    TemplateDirective,
    Strikethrough,
    Table,
    NakedURL,
    Hashtag,
    TaskDeadline,
    NamedAnchor,
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
          "TableDelimiter SubscriptMark SuperscriptMark StrikethroughMark":
            t.processingInstruction,
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
