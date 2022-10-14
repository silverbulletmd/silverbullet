import { collectNodesOfType, ParseTree } from "$sb/lib/tree.ts";
import Handlebars from "handlebars";
import * as YAML from "yaml";

import { space } from "$sb/silverbullet-syscall/mod.ts";
import { niceDate } from "$sb/lib/dates.ts";
import { ParsedQuery } from "$sb/lib/query.ts";

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
    let templateText = await space.readPage(parsedQuery.render);
    templateText = `{{#each .}}\n${templateText}\n{{/each}}`;
    const template = Handlebars.compile(templateText, { noEscape: true });
    return template(data);
  }

  return "ERROR";
}
