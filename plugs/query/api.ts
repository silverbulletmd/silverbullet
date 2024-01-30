import { parseQuery } from "$sb/lib/parse-query.ts";
import { Query } from "$sb/types.ts";
import { events } from "$sb/syscalls.ts";

export async function query(query: string): Promise<any> {
  const parsedQuery = await parseQuery(query);

  return queryParsed(parsedQuery);
}

export async function queryParsed(parsedQuery: Query) {
  if (!parsedQuery.limit) {
    parsedQuery.limit = ["number", 1000];
  }

  const eventName = `query:${parsedQuery.querySource}`;
  // console.log("Parsed query", parsedQuery);
  // Let's dispatch an event and see what happens
  const results = await events.dispatchEvent(
    eventName,
    { query: parsedQuery },
    30 * 1000,
  );
  if (results.length === 0) {
    throw new Error(`Unsupported query source '${parsedQuery.querySource}'`);
  }
  return results.flat();
}
