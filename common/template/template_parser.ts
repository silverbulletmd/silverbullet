import { LRLanguage } from "@codemirror/language";
import { parse } from "../markdown_parser/parse_tree.ts";

import { parser as templateParser } from "./parse-template.js";
import { parser as expressionParser } from "../markdown_parser/parse-expression.js";
import { parser as queryParser } from "../markdown_parser/parse-query.js";
import { AST, parseTreeToAST } from "../../plug-api/lib/tree.ts";
import { deepEqual } from "../../plug-api/lib/json.ts";

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
  // text = text.replaceAll(/(^|\n)(\{\{[#\/][^}]+\}\})(\n)/g, "$1$2");
  const tree = parse(templateLanguage, text);
  const ast = processTree(parseTreeToAST(tree, false));
  // console.log("AST", JSON.stringify(ast, null, 2));
  return ast;
}

function processTree(tree: AST): AST {
  switch (tree[0]) {
    case "Template":
      return [
        "Template",
        ...stripInitialNewline((tree.slice(1) as AST[]).map(processTree)),
      ];
    case "TemplateElement":
      return ["TemplateElement", ...(tree.slice(1) as AST[]).map(processTree)];
    case "ExpressionDirective": {
      let exprString = tree[2][1] as string;
      const legacyCallSyntax = /^([A-Za-z]+)\s+([^(]+$)/.exec(exprString);
      if (legacyCallSyntax) {
        // Translates "escapeRegex @page.name" -> "escapeRegex(@page.name)"
        const [_, fn, args] = legacyCallSyntax;
        exprString = `${fn}(${args})`;
        console.warn(
          "Translated legacy function call to new syntax",
          exprString,
        );
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
      const closingBlockName = tree[tree.length - 2][1];
      if (closingBlockName !== blockType) {
        throw new Error(
          `Block #${blockType} is not properly closed, saw /${closingBlockName} instead`,
        );
      }
      // const body = stripInitialNewline(bodyElements.map(processTree));
      const body = bodyElements.map(processTree);
      switch (blockType) {
        case "each": {
          const eachExpr = blockTextContent.trim();
          const eachVarMatch = eachExpr.match(/^@(\w+)\s+in\s+(.+)$/s);
          if (!eachVarMatch) {
            // Not a each var declaration, just an expression
            const expressionTree = parseTreeToAST(parse(
              expressionLanguage,
              blockTextContent.trim(),
            ));
            // console.log("Each body", bodyElements);
            return ["EachDirective", expressionTree[1], [
              "Template",
              ...stripInitialNewline(body),
            ]];
          }
          // This is a #each @p = version
          const expressionTree = parseTreeToAST(parse(
            expressionLanguage,
            eachVarMatch[2],
          ));
          return [
            "EachVarDirective",
            eachVarMatch[1],
            expressionTree[1],
            ["Template", ...stripInitialNewline(body)],
          ];
        }
        case "let": {
          const letExpr = blockTextContent.trim();
          const letMatch = letExpr.match(/^@(\w+)\s*=\s*(.+)$/s);
          if (!letMatch) {
            throw new Error(
              `A #let directive should be of the shape {{#let @var = expression}}, got instead: ${blockTextContent}`,
            );
          }
          const expressionTree = parseTreeToAST(parse(
            expressionLanguage,
            letMatch[2],
          ));
          return [
            "LetDirective",
            letMatch[1],
            expressionTree[1],
            ["Template", ...stripInitialNewline(body)],
          ];
        }
        case "if": {
          const expressionTree = parseTreeToAST(parse(
            expressionLanguage,
            blockTextContent.trim(),
          ));
          const elseIndex = body.findIndex((n) =>
            deepEqual(n, ["TemplateElement", ["ExpressionDirective", [
              "Expression",
              ["Identifier", "else"],
            ]]])
          );
          if (elseIndex !== -1) {
            return [
              "IfDirective",
              expressionTree[1],
              ["Template", ...stripInitialNewline(body.slice(0, elseIndex))],
              ["Template", ...stripInitialNewline(body.slice(elseIndex + 1))],
            ];
          } else {
            return ["IfDirective", expressionTree[1], [
              "Template",
              ...stripInitialNewline(body),
            ]];
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

function stripInitialNewline(body: any[]) {
  // body = [["TemplateElement", ["Text", "\n..."], ...]]
  let first = true;
  let stripNext = false;
  for (const el of body) {
    // Strip initial newline
    if (first && el[1][0] === "Text" && el[1][1].startsWith("\n")) {
      // Remove initial newline
      el[1][1] = el[1][1].slice(1);
    }
    first = false;

    // After each block directive, strip the next newline
    if (
      ["IfDirective", "EachDirective", "EachVarDirective", "LetDirective"]
        .includes(el[1][0])
    ) {
      // console.log("Got a block directive, consider stripping the next one", el);
      stripNext = true;
      continue;
    }
    if (
      el[1][0] === "Text" &&
      el[1][1].startsWith("\n") && stripNext
    ) {
      // console.log("Stripping initial newline from", el);
      el[1][1] = el[1][1].slice(1);
    }
    stripNext = false;
  }
  return body;
}
