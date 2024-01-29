import { LRLanguage } from "@codemirror/language";
import { parse } from "../markdown_parser/parse_tree.ts";
import { ParseTree, replaceNodesMatching } from "$sb/lib/tree.ts";

import { parser as templateParser } from "./parse-template.js";
import { parser as expressionParser } from "../markdown_parser/parse-expression.js";
import { parser as queryParser } from "../markdown_parser/parse-query.js";

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
  processTree(tree);
  return tree;
}

function processTree(tree: ParseTree) {
  replaceNodesMatching(tree, (node) => {
    console.log("node", node);
    if (node.type === "ExpressionDirective") {
      const expressionTree = parse(
        expressionLanguage,
        node.children![1].children![0].text!,
      );
      return {
        type: "ExpressionDirective",
        children: expressionTree.children,
      };
    }
    if (node.type === "BlockDirective") {
      const blockType = node.children![1].children![0].text!;
      console.log("FOUND A BLOCK", blockType, node);
      const blockTextContent = node.children![2].children![0].text!;
      const bodyElements: ParseTree = {
        type: "BlockBody",
        children: node.children!.filter((n) => n.type === "TemplateElement"),
      };

      processTree(bodyElements);

      switch (blockType) {
        case "each": {
          const expressionTree = parse(
            expressionLanguage,
            blockTextContent.trim(),
          );

          return {
            type: "EachDirective",
            children: [
              expressionTree.children![0]!,
              bodyElements,
            ],
          };
        }
        case "if": {
          const expressionTree = parse(
            expressionLanguage,
            blockTextContent.trim(),
          );
          return {
            type: "IfDirective",
            children: [
              expressionTree.children![0]!,
              bodyElements,
            ],
          };
        }
        case "query": {
          const queryTree = parse(
            queryLanguage,
            blockTextContent.trim(),
          );
          return {
            type: "QueryDirective",
            children: [
              queryTree.children![0]!,
              bodyElements,
            ],
          };
        }
        default: {
          throw new Error(`Unknown block type: ${blockType}`);
        }
      }
    }
    return undefined;
  });
}
