import type { AST } from "$sb/lib/tree.ts";
import type { Query, QueryExpression } from "$sb/types.ts";

export function astToKvQuery(
  node: AST,
): Query {
  const query: Query = {
    querySource: "",
  };
  const [queryType, querySource, ...clauses] = node;
  if (queryType !== "Query") {
    throw new Error(`Expected query type, got ${queryType}`);
  }
  // console.log(JSON.stringify(node, null, 2));
  query.querySource = querySource[1] as string;
  for (const clause of clauses) {
    const [clauseType] = clause;
    switch (clauseType) {
      case "WhereClause": {
        if (query.filter) {
          query.filter = [
            "and",
            query.filter,
            expressionToKvQueryFilter(clause[2]),
          ];
        } else {
          query.filter = expressionToKvQueryFilter(clause[2]);
        }
        break;
      }
      case "OrderClause": {
        const column = clause[2][1] as string;
        if (!query.orderBy) {
          query.orderBy = [];
        }
        if (clause[3]) {
          query.orderBy?.push({
            attribute: column,
            desc: clause[3][1][1] === "desc",
          });
        } else {
          query.orderBy.push({
            attribute: column,
            desc: false,
          });
        }
        break;
      }
      case "LimitClause": {
        query.limit = +(clause[2][1]);
        break;
      }
      case "SelectClause": {
        for (const select of clause.slice(2)) {
          if (select[0] === "Select") {
            if (!query.select) {
              query.select = [];
            }
            if (select.length === 2) {
              query.select.push({ name: select[1][1] as string });
            } else {
              query.select.push({
                name: select[3][1] as string,
                expr: expressionToKvQueryExpression(select[1]),
              });
            }
          }
        }
        break;
      }
      case "RenderClause": {
        query.render = (clause[2][1] as string).slice(2, -2);
        break;
      }
      default:
        throw new Error(`Unknown clause type: ${clauseType}`);
    }
  }
  return query;
}

function expressionToKvQueryExpression(node: AST): QueryExpression {
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
    case "null":
      return ["null"];
    case "Regex":
      return ["regexp", (node[1] as string).slice(1, -1), "i"];
    case "BinExpression": {
      const lval = expressionToKvQueryExpression(node[1]);
      const binOp = (node[2] as string).trim();
      const val = expressionToKvQueryExpression(node[3]);
      return [binOp as any, lval, val];
    }
    case "LogicalExpression": {
      const op1 = expressionToKvQueryFilter(node[1]);
      const op = node[2];
      const op2 = expressionToKvQueryFilter(node[3]);
      return [op[1] as any, op1, op2];
    }
    case "ParenthesizedExpression": {
      return expressionToKvQueryFilter(node[2]);
    }
    default:
      throw new Error(`Not supported: ${node[0]}`);
  }
}

function expressionToKvQueryFilter(
  node: AST,
): QueryExpression {
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
    case "ParenthesizedExpression": {
      return expressionToKvQueryFilter(node[2]);
    }
    default:
      throw new Error(`Unknown expression type: ${expressionType}`);
  }
}