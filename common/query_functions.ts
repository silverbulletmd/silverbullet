import { FunctionMap } from "$sb/types.ts";
import { builtinFunctions } from "$sb/lib/builtin_query_functions.ts";

export function buildQueryFunctions(allKnownPages: Set<string>): FunctionMap {
  return {
    ...builtinFunctions,
    pageExists: (name: string) => {
      if (name.startsWith("!") || name.startsWith("{{")) {
        // Let's assume federated pages exist, and ignore template variable ones
        return true;
      }
      return allKnownPages.has(name);
    },
  };
}
