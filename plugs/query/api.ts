import { parseQuery } from "$sb/lib/parse-query.ts";
import { Query } from "$sb/types.ts";
import { events } from "$sb/syscalls.ts";
import { QueryProviderEvent } from "$sb/app_event.ts";

export async function query(
  query: string,
  variables?: Record<string, any>,
): Promise<any> {
  const parsedQuery = await parseQuery(query);

  return queryParsed(parsedQuery, variables);
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
