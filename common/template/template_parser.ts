import { LRLanguage } from "@codemirror/language";
import { parse } from "../markdown_parser/parse_tree.ts";

import { parser as templateParser } from "./parse-template.js";
import { parser as expressionParser } from "../markdown_parser/parse-expression.js";
import { parser as queryParser } from "../markdown_parser/parse-query.js";
import { AST } from "$sb/lib/tree.ts";
import { parseTreeToAST } from "$sb/lib/tree.ts";
import { deepEqual } from "$sb/lib/json.ts";

export const templateLanguage = LRLanguage.define({
  name: "template",
  parser: templateParser,
});

export const expressionLanguage = LRLanguage.define({
  name: "expression",
  parser: expressionParser,
});

export const queryLanguage = LRLanguage.define({
  name: "query",
  parser: queryParser,
});

export function parseTemplate(text: string) {
  // Remove a newline after a singleton (only thing on the line) block open or close tag
  text = text.replaceAll(/(^|\n)(\{\{[#\/][^}]+\}\})(\n)/g, "$1$2");
  const tree = parse(templateLanguage, text);
  return processTree(parseTreeToAST(tree, false));
}

function processTree(tree: AST): AST {
  switch (tree[0]) {
    case "Template":
      return ["Template", ...(tree.slice(1) as AST[]).map(processTree)];
    case "TemplateElement":
      return ["TemplateElement", ...(tree.slice(1) as AST[]).map(processTree)];
    case "ExpressionDirective": {
      let exprString = tree[2][1] as string;
      const legacyCallSyntax = /(\w+)\s+([^(]+$)/.exec(exprString);
      if (legacyCallSyntax) {
        // Translates "escapeRegex @page.name" -> "escapeRegex(@page.name)"
        const [_, fn, args] = legacyCallSyntax;
        exprString = `${fn}(${args})`;
      }
      const expressionTree = parseTreeToAST(parse(
        expressionLanguage,
        exprString,
      ));
      return ["ExpressionDirective", expressionTree[1]];
    }
    case "BlockDirective": {
      const blockType = tree[2][1] as string;
      const blockTextContent = tree[3][1] as string;
      const bodyElements = (tree as any[]).filter((n) =>
        n[0] === "TemplateElement"
      );
      // const body = stripInitialNewline(bodyElements.map(processTree));
      const body = bodyElements.map(processTree);
      switch (blockType) {
        case "each": {
          const expressionTree = parseTreeToAST(parse(
            expressionLanguage,
            blockTextContent.trim(),
          ));
          // console.log("Each body", bodyElements);
          return ["EachDirective", expressionTree[1], ...body];
        }
        case "if": {
          const expressionTree = parseTreeToAST(parse(
            expressionLanguage,
            blockTextContent.trim(),
          ));
          const elseIndex = body.findIndex((n) =>
            deepEqual(n, ["TemplateElement", ["ExpressionDirective", [
              "Expression",
              [
                "LVal",
                [
                  "Identifier",
                  "else",
                ],
              ],
            ]]])
          );
          if (elseIndex !== -1) {
            return [
              "IfDirective",
              expressionTree[1],
              ["Template", ...body.slice(0, elseIndex)],
              ["Template", ...body.slice(elseIndex + 1)],
            ];
          } else {
            return ["IfDirective", expressionTree[1], ["Template", ...body]];
          }
        }
        default: {
          throw new Error(`Unknown block type: ${blockType}`);
        }
      }
    }
    case "Text":
      return tree;
    default:
      console.log("tree", tree);
      throw new Error(`Unknown node type: ${tree[0]}`);
  }
}
