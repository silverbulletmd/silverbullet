import { events } from "$sb/plugos-syscall/mod.ts";

import { replaceTemplateVars } from "../core/template.ts";
import { renderTemplate } from "./util.ts";
import { parseQuery } from "./parser.ts";
import { jsonToMDTable } from "./util.ts";

export async function queryDirectiveRenderer(
  _directive: string,
  pageName: string,
  query: string
): Promise<string> {
  console.log("gg");
  const parsedQuery = parseQuery(replaceTemplateVars(query, pageName));

  console.log("Parsed query", parsedQuery);
  // Let's dispatch an event and see what happens
  const results = await events.dispatchEvent(
    `query:${parsedQuery.table}`,
    { query: parsedQuery, pageName: pageName },
    30 * 1000
  );
  if (results.length === 0) {
    return "No results";
  } else if (results.length === 1) {
    if (parsedQuery.render) {
      const rendered = await renderTemplate(parsedQuery.render, results[0]);
      return rendered.trim();
    } else {
      return jsonToMDTable(results[0]);
    }
  } else {
    throw new Error(`Too many query results: ${results.length}`);
  }
}
