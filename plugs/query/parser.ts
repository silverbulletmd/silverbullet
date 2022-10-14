import {
  collectNodesOfType,
  findNodeOfType,
  replaceNodesMatching,
} from "$sb/lib/tree.ts";
import { lezerToParseTree } from "../../common/parse_tree.ts";
import { valueNodeToVal } from "./engine.ts";

// @ts-ignore auto generated
import { parser } from "./parse-query.js";
import { ParsedQuery, QueryFilter } from "$sb/lib/query.ts";

export function parseQuery(query: string): ParsedQuery {
  const n = lezerToParseTree(query, parser.parse(query).topNode);
  // Clean the tree a bit
  replaceNodesMatching(n, (n) => {
    if (!n.type) {
      const trimmed = n.text!.trim();
      if (!trimmed) {
        return null;
      }
      n.text = trimmed;
    }
  });

  // console.log("Parsed", JSON.stringify(n, null, 2));
  const queryNode = n.children![0];
  const parsedQuery: ParsedQuery = {
    table: queryNode.children![0].children![0].text!,
    filter: [],
  };
  const orderByNode = findNodeOfType(queryNode, "OrderClause");
  if (orderByNode) {
    const nameNode = findNodeOfType(orderByNode, "Name");
    parsedQuery.orderBy = nameNode!.children![0].text!;
    const orderNode = findNodeOfType(orderByNode, "Order");
    parsedQuery.orderDesc = orderNode
      ? orderNode.children![0].text! === "desc"
      : false;
  }
  const limitNode = findNodeOfType(queryNode, "LimitClause");
  if (limitNode) {
    const nameNode = findNodeOfType(limitNode, "Number");
    parsedQuery.limit = valueNodeToVal(nameNode!);
  }

  const filterNodes = collectNodesOfType(queryNode, "FilterExpr");
  for (const filterNode of filterNodes) {
    let val: any = undefined;
    const valNode = filterNode.children![2].children![0];
    val = valueNodeToVal(valNode);
    const f: QueryFilter = {
      prop: filterNode.children![0].children![0].text!,
      op: filterNode.children![1].text!,
      value: val,
    };
    parsedQuery.filter.push(f);
  }
  const selectNode = findNodeOfType(queryNode, "SelectClause");
  if (selectNode) {
    parsedQuery.select = [];
    collectNodesOfType(selectNode, "Name").forEach((t) => {
      parsedQuery.select!.push(t.children![0].text!);
    });
  }

  const renderNode = findNodeOfType(queryNode, "RenderClause");
  if (renderNode) {
    let renderNameNode = findNodeOfType(renderNode, "PageRef");
    if (!renderNameNode) {
      renderNameNode = findNodeOfType(renderNode, "String");
    }
    parsedQuery.render = valueNodeToVal(renderNameNode!);
  }

  return parsedQuery;
}
