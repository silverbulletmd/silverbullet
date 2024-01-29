import { LRLanguage } from "@codemirror/language";
import { parse } from "../markdown_parser/parse_tree.ts";
import { ParseTree, replaceNodesMatching } from "$sb/lib/tree.ts";

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
      // console.log("Body", bodyElements);
      const body = bodyElements.map(processTree);
      switch (blockType) {
        case "each": {
          const expressionTree = parseTreeToAST(parse(
            expressionLanguage,
            blockTextContent.trim(),
          ));
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
        case "query": {
          const queryTree = parseTreeToAST(parse(
            queryLanguage,
            blockTextContent.trim(),
          ));
          return ["QueryDirective", queryTree[1], ...body];
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
  // replaceNodesMatching(tree, (node) => {
  //   console.log("node", node);
  //   if (node.type === "ExpressionDirective") {
  //     const expressionTree = parse(
  //       expressionLanguage,
  //       node.children![1].children![0].text!,
  //     );
  //     return {
  //       type: "ExpressionDirective",
  //       children: expressionTree.children,
  //     };
  //   }
  //   if (node.type === "BlockDirective") {
  //     const blockType = node.children![1].children![0].text!;
  //     console.log("FOUND A BLOCK", blockType, node);
  //     const blockTextContent = node.children![2].children![0].text!;
  //     const bodyElements: ParseTree = {
  //       type: "BlockBody",
  //       children: node.children!.filter((n) => n.type === "TemplateElement"),
  //     };

  //     processTree(bodyElements);

  //     switch (blockType) {
  //       case "each": {
  //         const expressionTree = parse(
  //           expressionLanguage,
  //           blockTextContent.trim(),
  //         );

  //         return {
  //           type: "EachDirective",
  //           children: [
  //             expressionTree.children![0]!,
  //             bodyElements,
  //           ],
  //         };
  //       }
  //       case "if": {
  //         const expressionTree = parse(
  //           expressionLanguage,
  //           blockTextContent.trim(),
  //         );
  //         return {
  //           type: "IfDirective",
  //           children: [
  //             expressionTree.children![0]!,
  //             bodyElements,
  //           ],
  //         };
  //       }
  //       case "query": {
  //         const queryTree = parse(
  //           queryLanguage,
  //           blockTextContent.trim(),
  //         );
  //         return {
  //           type: "QueryDirective",
  //           children: [
  //             queryTree.children![0]!,
  //             bodyElements,
  //           ],
  //         };
  //       }
  //       default: {
  //         throw new Error(`Unknown block type: ${blockType}`);
  //       }
  //     }
  //   }
  //   return undefined;
  // });
}
