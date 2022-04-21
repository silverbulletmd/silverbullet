import { collectNodesOfType, findNodeOfType, replaceNodesMatching } from "@silverbulletmd/common/tree";
import { lezerToParseTree } from "@silverbulletmd/common/parse_tree";

// @ts-ignore
import { parser } from "./parse-query";

export type QueryProviderEvent = {
  query: ParsedQuery;
  pageName: string;
};

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
    parsedQuery.limit = +nameNode!.children![0].text!;
  }
  let filterNodes = collectNodesOfType(queryNode, "FilterExpr");
  for (let filterNode of filterNodes) {
    let val: any = undefined;
    let valNode = filterNode.children![2].children![0];
    switch (valNode.type) {
      case "Number":
        val = valNode.children![0].text!;
        break;
      case "Bool":
        val = valNode.children![0].text! === "true";
        break;
      case "Null":
        val = null;
        break;
      case "Name":
        val = valNode.children![0].text!;
        break;
      case "Regex":
        val = valNode.children![0].text!;
        val = val.substring(1, val.length - 1);
        break;
      case "String":
        val = valNode.children![0].text!;
        val = val.substring(1, val.length - 1);
        break;
    }
    let f: Filter = {
      prop: filterNode.children![0].children![0].text!,
      op: filterNode.children![1].text!,
      value: val,
    };
    parsedQuery.filter.push(f);
  }
  let selectNode = findNodeOfType(queryNode, "SelectClause");
  if (selectNode) {
    console.log("Select node", JSON.stringify(selectNode));
    parsedQuery.select = [];
    collectNodesOfType(selectNode, "Name").forEach((t) => {
      parsedQuery.select!.push(t.children![0].text!);
    });
    // let nameNode = findNodeOfType(selectNode, "Number");
    // parsedQuery.limit = +nameNode!.children![0].text!;
  }

  // console.log(JSON.stringify(queryNode, null, 2));
  return parsedQuery;
}

export function applyQuery<T>(parsedQuery: ParsedQuery, records: T[]): T[] {
  let resultRecords: any[] = [];
  if (parsedQuery.filter.length === 0) {
    resultRecords = records.slice();
  } else {
    recordLoop: for (let record of records) {
      const recordAny: any = record;
      for (let { op, prop, value } of parsedQuery.filter) {
        switch (op) {
          case "=":
            if (!(recordAny[prop] == value)) {
              continue recordLoop;
            }
            break;
          case "!=":
            if (!(recordAny[prop] != value)) {
              continue recordLoop;
            }
            break;
          case "<":
            if (!(recordAny[prop] < value)) {
              continue recordLoop;
            }
            break;
          case "<=":
            if (!(recordAny[prop] <= value)) {
              continue recordLoop;
            }
            break;
          case ">":
            if (!(recordAny[prop] > value)) {
              continue recordLoop;
            }
            break;
          case ">=":
            if (!(recordAny[prop] >= value)) {
              continue recordLoop;
            }
            break;
          case "=~":
            // TODO: Cache regexps somehow
            if (!new RegExp(value).exec(recordAny[prop])) {
              continue recordLoop;
            }
            break;
          case "!=~":
            if (new RegExp(value).exec(recordAny[prop])) {
              continue recordLoop;
            }
            break;
        }
      }
      resultRecords.push(recordAny);
    }
  }
  // Now the sorting
  if (parsedQuery.orderBy) {
    resultRecords = resultRecords.sort((a: any, b: any) => {
      const orderBy = parsedQuery.orderBy!;
      const orderDesc = parsedQuery.orderDesc!;
      if (a[orderBy] === b[orderBy]) {
        return 0;
      }

      if (a[orderBy] < b[orderBy]) {
        return orderDesc ? 1 : -1;
      } else {
        return orderDesc ? -1 : 1;
      }
    });
  }
  if (parsedQuery.limit) {
    resultRecords = resultRecords.slice(0, parsedQuery.limit);
  }
  if (parsedQuery.select) {
    resultRecords = resultRecords.map((rec) => {
      let newRec: any = {};
      for (let k of parsedQuery.select!) {
        newRec[k] = rec[k];
      }
      return newRec;
    });
  }
  return resultRecords;
}
