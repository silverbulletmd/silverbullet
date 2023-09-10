import { events } from "$sb/syscalls.ts";

import { replaceTemplateVars } from "../template/template.ts";
import { renderTemplate } from "./util.ts";
import { jsonToMDTable } from "./util.ts";
import { ParseTree, parseTreeToAST } from "$sb/lib/tree.ts";
import type { PageMeta } from "../../web/types.ts";
import { astToKvQuery } from "$sb/lib/parse-query.ts";
import type { Query } from "$sb/lib/query.ts";

export async function queryDirectiveRenderer(
  _directive: string,
  pageMeta: PageMeta,
  query: string | ParseTree,
): Promise<string> {
  if (typeof query === "string") {
    throw new Error("Argument must be a ParseTree");
  }
  const parsedQuery: Query = astToKvQuery(
    parseTreeToAST(
      JSON.parse(replaceTemplateVars(JSON.stringify(query), pageMeta)),
    ),
  );
  console.log("QUERY", parsedQuery);

  const eventName = `query:${parsedQuery.querySource}`;

  // console.log("Parsed query", parsedQuery);
  // Let's dispatch an event and see what happens
  const results = await events.dispatchEvent(
    eventName,
    { query: parsedQuery, pageName: pageMeta.name },
    30 * 1000,
  );
  if (results.length === 0) {
    // This means there was no handler for the event which means it's unsupported
    return `**Error:** Unsupported query source '${parsedQuery.querySource}'`;
  } else if (results.length === 1) {
    // console.log("Parsed query", parsedQuery);
    if (parsedQuery.render) {
      const rendered = await renderTemplate(
        pageMeta,
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
