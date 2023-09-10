import { findNodeOfType, ParseTree, renderToText } from "$sb/lib/tree.ts";
import {
  KvQuery,
  KvQueryExpression,
  KvQueryFilter,
} from "../../plugos/lib/datastore.ts";
import { Expression } from "./parse-query.terms.js";

export function parseTreeToKvQuery(
  tree: ParseTree,
): KvQuery {
  let query: KvQuery = {
    prefix: [],
  };
  const querySourceNode = tree.children![0].children![0];
  query.prefix = [querySourceNode.text!];
  for (const child of tree.children!) {
    switch (child.type) {
      case "WhereClause": {
        const expression = findNodeOfType(child, "Expression")!;
        query.filter = expressionToKvQueryFilter(expression);
      }
    }
  }
  return query;
}

function expressionToKvQueryExpression(tree: ParseTree): KvQueryExpression {
  if (["LVal", "Expression", "Value"].includes(tree.type!)) {
    return expressionToKvQueryExpression(tree.children![0]);
  }
  //   console.log("Got expression", tree);
  switch (tree.type) {
    case "Attribute":
      return ["attr", renderToText(tree)];
    case "Identifier":
      return ["attr", renderToText(tree)];
    case "String":
      return ["string", renderToText(tree).slice(1, -1)];
    case "Number":
      return ["number", +renderToText(tree)];
    case "Bool":
      return ["boolean", renderToText(tree) === "true"];
    default:
      throw new Error(`Not supported: ${tree.type}`);
  }
}

function expressionToKvQueryFilter(
  tree: ParseTree,
): KvQueryFilter {
  const expressionType = tree.children![0].type;
  const node = tree.children![0];
  switch (expressionType) {
    case "BinExpression": {
      const lval = expressionToKvQueryExpression(node.children![0]);
      const binOp = node.children![1].text!.trim();
      const val = expressionToKvQueryExpression(node.children![2]);
      return [binOp as any, lval, val];
    }
    case "LogicalExpression": {
      //   console.log("Logical expression", node);
      // 0 = first operand, 1 = whitespace, 2 = operator, 3 = whitespace, 4 = second operand
      const op1 = expressionToKvQueryFilter(node.children![0]);
      const op = node.children![2].type!; // 1 is whitespace
      const op2 = expressionToKvQueryFilter(
        node.children![4],
      );
      return [op as any, op1, op2];
    }
    default:
      throw new Error(`Unknown expression type: ${expressionType}`);
  }
}
