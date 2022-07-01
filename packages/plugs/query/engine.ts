import {
  collectNodesOfType,
  findNodeOfType,
  ParseTree,
  replaceNodesMatching,
} from "@silverbulletmd/common/tree";
import { lezerToParseTree } from "@silverbulletmd/common/parse_tree";
import Handlebars from "handlebars";
import YAML from "yaml";

// @ts-ignore
import { parser } from "./parse-query";
import { readPage } from "@silverbulletmd/plugos-silverbullet-syscall/space";
import { niceDate } from "../core/dates";

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

function valueNodeToVal(valNode: ParseTree): any {
  switch (valNode.type) {
    case "Number":
      return +valNode.children![0].text!;
    case "Bool":
      return valNode.children![0].text! === "true";
    case "Null":
      return null;
    case "Name":
      return valNode.children![0].text!;
    case "Regex":
      let val = valNode.children![0].text!;
      return val.substring(1, val.length - 1);
    case "String":
      let stringVal = valNode.children![0].text!;
      return stringVal.substring(1, stringVal.length - 1);
    case "List":
      return collectNodesOfType(valNode, "Value").map((t) =>
        valueNodeToVal(t.children![0])
      );
  }
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
          case "in":
            if (!value.includes(recordAny[prop])) {
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

export async function renderQuery(
  parsedQuery: ParsedQuery,
  data: any[]
): Promise<string> {
  if (parsedQuery.render) {
    Handlebars.registerHelper("json", (v) => JSON.stringify(v));
    Handlebars.registerHelper("niceDate", (ts) => niceDate(new Date(ts)));
    Handlebars.registerHelper("yaml", (v, prefix) => {
      if (typeof prefix === "string") {
        let yaml = YAML.stringify(v)
          .split("\n")
          .join("\n" + prefix)
          .trim();
        if (Array.isArray(v)) {
          return "\n" + prefix + yaml;
        } else {
          return yaml;
        }
      } else {
        return YAML.stringify(v).trim();
      }
    });
    let { text: templateText } = await readPage(parsedQuery.render);
    templateText = `{{#each .}}\n${templateText}\n{{/each}}`;
    let template = Handlebars.compile(templateText, { noEscape: true });
    return template(data);
  }

  return "ERROR";
}
