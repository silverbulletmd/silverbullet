import {
  collectNodesOfType,
  findNodeOfType,
  ParseTree,
  replaceNodesMatching,
} from "$sb/lib/tree.ts";

// @ts-ignore auto generated
import { ParsedQuery, QueryFilter } from "$sb/lib/query.ts";

export function parseQuery(queryTree: ParseTree): ParsedQuery {
  // const n = lezerToParseTree(query, parser.parse(query).topNode);
  // Clean the tree a bit
  replaceNodesMatching(queryTree, (n) => {
    if (!n.type) {
      const trimmed = n.text!.trim();
      if (!trimmed) {
        return null;
      }
      n.text = trimmed;
    }
  });

  // console.log("Parsed", JSON.stringify(n, null, 2));
  const queryNode = queryTree.children![0];
  const parsedQuery: ParsedQuery = {
    table: queryNode.children![0].children![0].text!,
    filter: [],
    ordering: [],
  };

  const orderByNodes = collectNodesOfType(queryNode, "OrderClause");
  for (const orderByNode of orderByNodes) {
    const nameNode = findNodeOfType(orderByNode, "Name");
    const orderBy = nameNode!.children![0].text!;
    const orderNode = findNodeOfType(orderByNode, "OrderDirection");
    const orderDesc = orderNode
      ? orderNode.children![0].text! === "desc"
      : false;
    parsedQuery.ordering.push({ orderBy, orderDesc });
  }
  /**
   * @deprecated due to PR #387
   * We'll take the first ordering and send that as the deprecated
   * fields orderBy and orderDesc. This way it will be backward
   * Plugs using the old ParsedQuery.
   * Remove this block completely when ParsedQuery no longer have
   * those two fields
   */
  if (parsedQuery.ordering.length > 0) {
    parsedQuery.orderBy = parsedQuery.ordering[0].orderBy;
    parsedQuery.orderDesc = parsedQuery.ordering[0].orderDesc;
  }
  /** @end-deprecation due to PR #387  */

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

export function valueNodeToVal(valNode: ParseTree): any {
  switch (valNode.type) {
    case "Number":
      return +valNode.children![0].text!;
    case "Bool":
      return valNode.children![0].text! === "true";
    case "Null":
      return null;
    case "Name":
      return valNode.children![0].text!;
    case "Regex": {
      const val = valNode.children![0].text!;
      return val.substring(1, val.length - 1);
    }
    case "String": {
      const stringVal = valNode.children![0].text!;
      return stringVal.substring(1, stringVal.length - 1);
    }
    case "PageRef": {
      const pageRefVal = valNode.children![0].text!;
      return pageRefVal.substring(2, pageRefVal.length - 2);
    }
    case "List": {
      return collectNodesOfType(valNode, "Value").map((t) =>
        valueNodeToVal(t.children![0])
      );
    }
  }
}
