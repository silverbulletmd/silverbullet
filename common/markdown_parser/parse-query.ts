import { AST, findNodeOfType, ParseTree, renderToText } from "$sb/lib/tree.ts";
import {
  KvQuery,
  KvQueryExpression,
  KvQueryFilter,
} from "../../plugos/lib/datastore.ts";

export function astToKvQuery(
  node: AST,
): KvQuery {
  const query: KvQuery = {
    prefix: [],
  };
  const [queryType, querySource, ...clauses] = node;
  if (queryType !== "Query") {
    throw new Error(`Expected query type, got ${queryType}`);
  }
  console.log(node);
  query.prefix = [querySource[1] as string];
  for (const clause of clauses) {
    const [clauseType] = clause;
    switch (clauseType) {
      case "WhereClause": {
        query.filter = expressionToKvQueryFilter(clause[2]);
      }
    }
  }
  return query;
}

function expressionToKvQueryExpression(node: AST): KvQueryExpression {
  if (["LVal", "Expression", "Value"].includes(node[0])) {
    return expressionToKvQueryExpression(node[1]);
  }
  //   console.log("Got expression", node);
  switch (node[0]) {
    case "Attribute": {
      return [
        "attr",
        expressionToKvQueryExpression(node[1]),
        node[3][1] as string,
      ];
    }
    case "Identifier":
      return ["attr", node[1] as string];
    case "String":
      return ["string", (node[1] as string).slice(1, -1)];
    case "Number":
      return ["number", +(node[1])];
    case "Bool":
      return ["boolean", node[1][1] === "true"];
    default:
      throw new Error(`Not supported: ${node[0]}`);
  }
}

function expressionToKvQueryFilter(
  node: AST,
): KvQueryFilter {
  const [expressionType] = node;
  if (expressionType === "Expression") {
    return expressionToKvQueryFilter(node[1]);
  }
  switch (expressionType) {
    case "BinExpression": {
      const lval = expressionToKvQueryExpression(node[1]);
      const binOp = (node[2] as string).trim();
      const val = expressionToKvQueryExpression(node[3]);
      return [binOp as any, lval, val];
    }
    case "LogicalExpression": {
      //   console.log("Logical expression", node);
      // 0 = first operand, 1 = whitespace, 2 = operator, 3 = whitespace, 4 = second operand
      const op1 = expressionToKvQueryFilter(node[1]);
      const op = node[2]; // 1 is whitespace
      const op2 = expressionToKvQueryFilter(node[3]);
      return [op[1] as any, op1, op2];
    }
    default:
      throw new Error(`Unknown expression type: ${expressionType}`);
  }
}
