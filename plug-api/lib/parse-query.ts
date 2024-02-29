import { type AST, parseTreeToAST } from "./tree.ts";
import type { Query, QueryExpression } from "../types.ts";
import { language } from "$sb/syscalls.ts";

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
  query.querySource = querySource[1] as string;
  for (const clause of clauses) {
    const [clauseType] = clause;
    switch (clauseType) {
      case "WhereClause": {
        if (query.filter) {
          query.filter = [
            "and",
            query.filter,
            expressionToKvQueryExpression(clause[2]),
          ];
        } else {
          query.filter = expressionToKvQueryExpression(clause[2]);
        }
        break;
      }
      case "OrderClause": {
        if (!query.orderBy) {
          query.orderBy = [];
        }
        for (const orderBy of clause.slice(2)) {
          if (orderBy[0] === "OrderBy") {
            // console.log("orderBy", orderBy);
            const expr = orderBy[1][1];
            if (orderBy[2]) {
              query.orderBy.push({
                expr: expressionToKvQueryExpression(expr),
                desc: orderBy[2][1][1] === "desc",
              });
            } else {
              query.orderBy.push({
                expr: expressionToKvQueryExpression(expr),
                desc: false,
              });
            }
          }
        }

        break;
      }
      case "LimitClause": {
        query.limit = expressionToKvQueryExpression(clause[2][1]);
        break;
      }
      case "SelectClause": {
        for (const select of clause.slice(2)) {
          if (select[0] === "Select") {
            if (!query.select) {
              query.select = [];
            }
            if (select.length === 2) {
              query.select.push({
                name: cleanIdentifier(select[1][1] as string),
              });
            } else {
              query.select.push({
                name: cleanIdentifier(select[3][1] as string),
                expr: expressionToKvQueryExpression(select[1]),
              });
            }
          }
        }
        break;
      }
      case "RenderClause": {
        // console.log("Render clause", clause);
        const pageRef = (clause as any[]).find((c) => c[0] === "PageRef");
        query.render = pageRef[1].slice(2, -2);
        query.renderAll = !!(clause as any[]).find((c) => c[0] === "all");
        break;
      }
      default:
        throw new Error(`Unknown clause type: ${clauseType}`);
    }
  }
  return query;
}

function cleanIdentifier(s: string): string {
  if (s.startsWith("`") && s.endsWith("`")) {
    return s.slice(1, -1);
  }
  return s;
}

export function expressionToKvQueryExpression(node: AST): QueryExpression {
  if (["LVal", "Expression", "Value"].includes(node[0])) {
    return expressionToKvQueryExpression(node[1]);
  }
  //   console.log("Got expression", node);
  switch (node[0]) {
    case "Attribute": {
      return [
        "attr",
        expressionToKvQueryExpression(node[1]),
        cleanIdentifier(node[3][1] as string),
      ];
    }
    case "Identifier":
      return ["attr", cleanIdentifier(node[1] as string)];
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
    case "List": {
      const exprs: AST[] = [];
      for (const expr of node.slice(2)) {
        if (expr[0] === "Expression") {
          exprs.push(expr);
        }
      }
      return ["array", exprs.map(expressionToKvQueryExpression)];
    }
    case "Object": {
      const objAttrs: [string, QueryExpression][] = [];
      for (const kv of node.slice(2)) {
        if (typeof kv === "string") {
          continue;
        }
        const [_, key, _colon, expr] = kv;
        objAttrs.push([
          key[1].slice(1, -1) as string,
          expressionToKvQueryExpression(
            expr,
          ),
        ]);
      }
      return ["object", objAttrs];
    }
    case "BinExpression": {
      const lval = expressionToKvQueryExpression(node[1]);
      const binOp = node[2][0] === "InKW" ? "in" : (node[2] as string).trim();
      const val = expressionToKvQueryExpression(node[3]);
      return [binOp as any, lval, val];
    }
    case "LogicalExpression": {
      const op1 = expressionToKvQueryExpression(node[1]);
      const op = node[2];
      const op2 = expressionToKvQueryExpression(node[3]);
      return [op[1] as any, op1, op2];
    }
    case "ParenthesizedExpression": {
      return expressionToKvQueryExpression(node[2]);
    }
    case "Call": {
      // console.log("Call", node);
      const fn = cleanIdentifier(node[1][1] as string);
      const args: AST[] = [];
      for (const expr of node.slice(2)) {
        if (expr[0] === "Expression") {
          args.push(expr);
        }
      }
      return ["call", fn, args.map(expressionToKvQueryExpression)];
    }
    case "UnaryExpression": {
      // console.log("UnaryExpression", node);
      if (node[1][0] === "NotKW" || node[1][0] === "!") {
        return ["not", expressionToKvQueryExpression(node[2])];
      } else if (node[1][0] === "-") {
        return ["-", expressionToKvQueryExpression(node[2])];
      }
      throw new Error(`Unknown unary expression: ${node[1][0]}`);
    }
    case "TopLevelVal": {
      return ["attr"];
    }
    case "GlobalIdentifier": {
      return ["global", (node[1] as string).substring(1)];
    }
    case "TernaryExpression": {
      const [_, condition, _space, ifTrue, _space2, ifFalse] = node;
      return [
        "?",
        expressionToKvQueryExpression(condition),
        expressionToKvQueryExpression(ifTrue),
        expressionToKvQueryExpression(ifFalse),
      ];
    }
    case "QueryExpression": {
      return ["query", astToKvQuery(node[2])];
    }
    case "PageRef": {
      return ["pageref", (node[1] as string).slice(2, -2)];
    }
    default:
      throw new Error(`Not supported: ${node[0]}`);
  }
}
export async function parseQuery(query: string): Promise<Query> {
  const queryAST = parseTreeToAST(
    await language.parseLanguage(
      "query",
      query,
    ),
  );
  return astToKvQuery(queryAST[1]);
}
