import { parseQuery } from "$sb/lib/parse-query.ts";
import { Query } from "../../plug-api/types.ts";
import { events } from "$sb/syscalls.ts";
import { QueryProviderEvent } from "../../plug-api/types.ts";
import { resolvePath } from "$sb/lib/resolve.ts";
import { renderQueryTemplate } from "../template/util.ts";

export async function query(
  query: string,
  variables?: Record<string, any>,
): Promise<any> {
  const parsedQuery = await parseQuery(query);

  return queryParsed(parsedQuery, variables);
}

/**
 * Renders a query either as a result array, or as a rendered template when the `render` clause is defined
 * @param parsedQuery
 * @param variables
 * @returns Promise<any[] | string>: a string if the query has a `render` clause, or an array of results
 */
export async function renderQuery(
  parsedQuery: Query,
  variables?: Record<string, any>,
): Promise<any[] | string> {
  const results = await queryParsed(parsedQuery, variables);
  if (parsedQuery.render) {
    if (results.length === 0 && !parsedQuery.renderAll) {
      return "No results";
    }
    // Configured a custom rendering template, let's use it!
    const templatePage = resolvePath(
      variables?.page?.name,
      parsedQuery.render,
    );
    const rendered = await renderQueryTemplate(
      variables?.page,
      templatePage,
      results,
      parsedQuery.renderAll!,
    );
    return rendered.trim();
  }

  return results;
}

export async function queryParsed(
  parsedQuery: Query,
  variables?: Record<string, any>,
) {
  if (!parsedQuery.limit) {
    parsedQuery.limit = ["number", 1000];
  }

  const eventName = `query:${parsedQuery.querySource}`;
  // console.log("Parsed query", parsedQuery);
  // Let's dispatch an event and see what happens
  const event: QueryProviderEvent = { query: parsedQuery };
  if (variables) {
    event.variables = variables;
  }
  const results = await events.dispatchEvent(eventName, event, 30 * 1000);
  if (results.length === 0) {
    throw new Error(`Unsupported query source '${parsedQuery.querySource}'`);
  }
  return results.flat();
}
