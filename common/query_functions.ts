import { FunctionMap } from "$sb/types.ts";
import { builtinFunctions } from "$sb/lib/builtin_query_functions.ts";
import { System } from "../plugos/system.ts";
import { Query } from "$sb/types.ts";

export function buildQueryFunctions(
  allKnownPages: Set<string>,
  system: System<any>,
): FunctionMap {
  return {
    ...builtinFunctions,
    pageExists: (name: string) => {
      if (name.startsWith("!") || name.startsWith("{{")) {
        // Let's assume federated pages exist, and ignore template variable ones
        return true;
      }
      return allKnownPages.has(name);
    },
    readPage: (name: string) => {
      return system.syscall({}, "space.readPage", [name]);
    },
    $query: (query: Query, variables: Record<string, any>) => {
      return system.invokeFunction("query.queryParsed", [
        query,
        variables,
      ]);
    },
  };
}
