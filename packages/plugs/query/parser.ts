import {
  collectNodesOfType,
  findNodeOfType,
  replaceNodesMatching,
} from "@silverbulletmd/common/tree";
import { lezerToParseTree } from "@silverbulletmd/common/parse_tree";
import { valueNodeToVal } from "./engine";

// @ts-ignore
import { parser } from "./parse-query";

export type Filter = {
  op: string;
  prop: string;
  value: any;
};

export type ParsedQuery = {
  table: string;
  orderBy?: string;
  orderDesc?: boolean;
  limit?: number;
  filter: Filter[];
  select?: string[];
  render?: string;
};

export function parseQuery(query: string): ParsedQuery {
  let n = lezerToParseTree(query, parser.parse(query).topNode);
  // Clean the tree a bit
  replaceNodesMatching(n, (n) => {
    if (!n.type) {
      let trimmed = n.text!.trim();
      if (!trimmed) {
        return null;
      }
      n.text = trimmed;
    }
  });

  // console.log("Parsed", JSON.stringify(n, null, 2));
  let queryNode = n.children![0];
  let parsedQuery: ParsedQuery = {
    table: queryNode.children![0].children![0].text!,
    filter: [],
  };
  let orderByNode = findNodeOfType(queryNode, "OrderClause");
  if (orderByNode) {
    let nameNode = findNodeOfType(orderByNode, "Name");
    parsedQuery.orderBy = nameNode!.children![0].text!;
    let orderNode = findNodeOfType(orderByNode, "Order");
    parsedQuery.orderDesc = orderNode
      ? orderNode.children![0].text! === "desc"
      : false;
  }
  let limitNode = findNodeOfType(queryNode, "LimitClause");
  if (limitNode) {
    let nameNode = findNodeOfType(limitNode, "Number");
    parsedQuery.limit = valueNodeToVal(nameNode!);
  }

  let filterNodes = collectNodesOfType(queryNode, "FilterExpr");
  for (let filterNode of filterNodes) {
    let val: any = undefined;
    let valNode = filterNode.children![2].children![0];
    val = valueNodeToVal(valNode);
    let f: Filter = {
      prop: filterNode.children![0].children![0].text!,
      op: filterNode.children![1].text!,
      value: val,
    };
    parsedQuery.filter.push(f);
  }
  let selectNode = findNodeOfType(queryNode, "SelectClause");
  if (selectNode) {
    // console.log("Select node", JSON.stringify(selectNode));
    parsedQuery.select = [];
    collectNodesOfType(selectNode, "Name").forEach((t) => {
      parsedQuery.select!.push(t.children![0].text!);
    });
    // let nameNode = findNodeOfType(selectNode, "Number");
    // parsedQuery.limit = +nameNode!.children![0].text!;
  }

  let renderNode = findNodeOfType(queryNode, "RenderClause");
  if (renderNode) {
    let renderNameNode = findNodeOfType(renderNode, "String");
    parsedQuery.render = valueNodeToVal(renderNameNode!);
  }

  // console.log(JSON.stringify(queryNode, null, 2));
  return parsedQuery;
}
