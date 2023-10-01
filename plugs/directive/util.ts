import { handlebars, space } from "$sb/syscalls.ts";
import { handlebarHelpers } from "../../common/syscalls/handlebar_helpers.ts";
import { PageMeta } from "$sb/types.ts";

const maxWidth = 70;

export function defaultJsonTransformer(_k: string, v: any) {
  if (v === undefined) {
    return "";
  }
  if (typeof v === "string") {
    return v.replaceAll("\n", " ").replaceAll("|", "\\|");
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
  pageMeta: PageMeta,
  renderTemplate: string,
  data: any[],
): Promise<string> {
  let templateText = await space.readPage(renderTemplate);
  templateText = `{{#each .}}\n${templateText}\n{{/each}}`;
  console.log("New implementation");
  // const template = Handlebars.compile(templateText, { noEscape: true });
  // return template(data, buildHandebarOptions(pageMeta));
  return handlebars.renderTemplate(templateText, data, { page: pageMeta });
}

export function buildHandebarOptions(pageMeta: PageMeta) {
  return {
    helpers: handlebarHelpers(),
    data: { page: pageMeta },
  };
}
