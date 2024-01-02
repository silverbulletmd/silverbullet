import { determineTags } from "$sb/lib/cheap_yaml.ts";
import { handlebarHelpers } from "../../common/syscalls/handlebar_helpers.ts";
import { PageMeta } from "$sb/types.ts";
import { handlebars, space } from "$sb/syscalls.ts";
import { cleanTemplate } from "./plug_api.ts";

const frontMatterRegex = /^---\n(([^\n]|\n)*?)---\n/;

/**
 * Quick and dirty way to check if a page is a template or not
 * @param pageText
 * @returns
 */
export function isTemplate(pageText: string): boolean {
  const frontmatter = frontMatterRegex.exec(pageText);
  // Poor man's YAML frontmatter parsing
  if (frontmatter) {
    pageText = pageText.slice(frontmatter[0].length);
    const frontmatterText = frontmatter[1];
    const tags = determineTags(frontmatterText);
    if (tags.includes("template")) {
      return true;
    }
  }
  // Or if the page text starts with a #template tag
  if (/^\s*#template(\W|$)/.test(pageText)) {
    return true;
  }
  return false;
}

export function buildHandebarOptions(pageMeta: PageMeta) {
  return {
    helpers: handlebarHelpers(),
    data: { page: pageMeta },
  };
}

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
  const headers = new Set<string>();
  for (const entry of jsonArray) {
    for (const k of Object.keys(entry)) {
      headers.add(k);
    }
  }

  const headerList = [...headers];
  const lines = [];
  lines.push(
    "|" +
      headerList
        .map(
          (headerName) => headerName,
        )
        .join("|") +
      "|",
  );
  lines.push(
    "|" +
      headerList
        .map(() => "--")
        .join("|") +
      "|",
  );
  for (const val of jsonArray) {
    const el = [];
    for (const prop of headerList) {
      const s = valueTransformer(prop, val[prop]);
      el.push(s);
    }
    lines.push("|" + el.join("|") + "|");
  }
  return lines.join("\n");
}

export async function renderQueryTemplate(
  pageMeta: PageMeta,
  templatePage: string,
  data: any[],
  renderAll: boolean,
): Promise<string> {
  let templateText = await space.readPage(templatePage);
  templateText = await cleanTemplate(templateText);

  if (!renderAll) {
    templateText = `{{#each .}}\n${templateText}\n{{/each}}`;
  }
  return handlebars.renderTemplate(templateText, data, { page: pageMeta });
}
