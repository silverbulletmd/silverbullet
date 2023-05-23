import Handlebars from "handlebars";

import { space } from "$sb/silverbullet-syscall/mod.ts";
import { niceDate } from "$sb/lib/dates.ts";

const maxWidth = 70;

export function defaultJsonTransformer(_k: string, v: any) {
  if (v === undefined) {
    return "";
  }
  return "" + v;
}

// Nicely format an array of JSON objects as a Markdown table
export function jsonToMDTable(
  jsonArray: any[],
  valueTransformer: (k: string, v: any) => string = defaultJsonTransformer,
): string {
  const fieldWidths = new Map<string, number>();
  for (const entry of jsonArray) {
    for (const k of Object.keys(entry)) {
      let fieldWidth = fieldWidths.get(k);
      if (!fieldWidth) {
        fieldWidth = valueTransformer(k, entry[k]).length;
      } else {
        fieldWidth = Math.max(valueTransformer(k, entry[k]).length, fieldWidth);
      }
      fieldWidths.set(k, fieldWidth);
    }
  }

  let fullWidth = 0;
  for (const v of fieldWidths.values()) {
    fullWidth += v + 1;
  }

  const headerList = [...fieldWidths.keys()];
  const lines = [];
  lines.push(
    "|" +
      headerList
        .map(
          (headerName) =>
            headerName +
            charPad(" ", fieldWidths.get(headerName)! - headerName.length),
        )
        .join("|") +
      "|",
  );
  lines.push(
    "|" +
      headerList
        .map((title) => charPad("-", fieldWidths.get(title)!))
        .join("|") +
      "|",
  );
  for (const val of jsonArray) {
    const el = [];
    for (const prop of headerList) {
      const s = valueTransformer(prop, val[prop]);
      el.push(s + charPad(" ", fieldWidths.get(prop)! - s.length));
    }
    lines.push("|" + el.join("|") + "|");
  }
  return lines.join("\n");

  function charPad(ch: string, length: number) {
    if (fullWidth > maxWidth && ch === "") {
      return "";
    } else if (fullWidth > maxWidth && ch === "-") {
      return "--";
    }
    if (length < 1) {
      return "";
    }
    return new Array(length + 1).join(ch);
  }
}

export async function renderTemplate(
  renderTemplate: string,
  data: any[],
): Promise<string> {
  registerHandlebarsHelpers();

  // Handlebars.registerHelper("yaml", (v: any, prefix: string) => {
  //   if (typeof prefix === "string") {
  //     let yaml = (await YAML.stringify(v))
  //       .split("\n")
  //       .join("\n" + prefix)
  //       .trim();
  //     if (Array.isArray(v)) {
  //       return "\n" + prefix + yaml;
  //     } else {
  //       return yaml;
  //     }
  //   } else {
  //     return YAML.stringify(v).trim();
  //   }
  // });
  let templateText = await space.readPage(renderTemplate);
  templateText = `{{#each .}}\n${templateText}\n{{/each}}`;
  const template = Handlebars.compile(templateText, { noEscape: true });
  return template(data);
}

export function registerHandlebarsHelpers() {
  Handlebars.registerHelper("json", (v: any) => JSON.stringify(v));
  Handlebars.registerHelper("niceDate", (ts: any) => niceDate(new Date(ts)));
  Handlebars.registerHelper("escapeRegexp", (ts: any) => {
    return ts.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
  });
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
}
