import { events } from "$sb/plugos-syscall/mod.ts";

import { replaceTemplateVars } from "../core/template.ts";
import { renderTemplate } from "./util.ts";
import { parseQuery } from "./parser.ts";
import { jsonToMDTable } from "./util.ts";
import { ParseTree } from "$sb/lib/tree.ts";

export async function queryDirectiveRenderer(
  _directive: string,
  pageName: string,
  query: string | ParseTree,
): Promise<string> {
  if (typeof query === "string") {
    throw new Error("Argument must be a ParseTree");
  }
  const parsedQuery = parseQuery(
    JSON.parse(replaceTemplateVars(JSON.stringify(query), pageName)),
  );

  const eventName = `query:${parsedQuery.table}`;

  // console.log("Parsed query", parsedQuery);
  // Let's dispatch an event and see what happens
  const results = await events.dispatchEvent(
    eventName,
    { query: parsedQuery, pageName: pageName },
    30 * 1000,
  );
  if (results.length === 0) {
    // This means there was no handler for the event which means it's unsupported
    return `**Error:** Unsupported query source '${parsedQuery.table}'`;
  } else if (results.length === 1) {
    // console.log("Parsed query", parsedQuery);
    if (parsedQuery.render) {
      const rendered = await renderTemplate(
        parsedQuery.render,
        results[0],
      );
      return rendered.trim();
    } else {
      if (results[0].length === 0) {
        return "No results";
      } else {
        return jsonToMDTable(results[0]);
      }
    }
  } else {
    throw new Error(`Too many query results: ${results.length}`);
  }
}
