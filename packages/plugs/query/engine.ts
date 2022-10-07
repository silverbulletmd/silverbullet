import { collectNodesOfType, ParseTree } from "../../common/tree.ts";
import Handlebars from "handlebars";
import * as YAML from "yaml";

import { readPage } from "../../plugos-silverbullet-syscall/space.ts";
import { niceDate } from "../core/dates.ts";
import { ParsedQuery } from "./parser.ts";

export type QueryProviderEvent = {
  query: ParsedQuery;
  pageName: string;
};

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
    case "Regex":
      let val = valNode.children![0].text!;
      return val.substring(1, val.length - 1);
    case "String":
      let stringVal = valNode.children![0].text!;
      return stringVal.substring(1, stringVal.length - 1);
    case "PageRef":
      let pageRefVal = valNode.children![0].text!;
      return pageRefVal.substring(2, pageRefVal.length - 2);
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
    recordLoop:
    for (let record of records) {
      const recordAny: any = record;
      for (let { op, prop, value } of parsedQuery.filter) {
        switch (op) {
          case "=":
            const recordPropVal = recordAny[prop];
            if (Array.isArray(recordPropVal) && !Array.isArray(value)) {
              // Record property is an array, and value is a scalar: find the value in the array
              if (!recordPropVal.includes(value)) {
                continue recordLoop;
              }
            } else if (Array.isArray(recordPropVal) && Array.isArray(value)) {
              // Record property is an array, and value is an array: find the value in the array
              if (!recordPropVal.some((v) => value.includes(v))) {
                continue recordLoop;
              }
            } else if (!(recordPropVal == value)) {
              // Both are scalars: exact value
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
  data: any[],
): Promise<string> {
  if (parsedQuery.render) {
    Handlebars.registerHelper("json", (v: any) => JSON.stringify(v));
    Handlebars.registerHelper("niceDate", (ts: any) => niceDate(new Date(ts)));
    Handlebars.registerHelper("prefixLines", (v: string, prefix: string) =>
      v
        .split("\n")
        .map((l) => prefix + l)
        .join("\n"));

    Handlebars.registerHelper(
      "substring",
      (s: string, from: number, to: number, elipsis = "") =>
        s.length > to - from ? s.substring(from, to) + elipsis : s,
    );

    Handlebars.registerHelper("yaml", (v: any, prefix: string) => {
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
