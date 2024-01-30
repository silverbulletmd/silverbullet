import { FunctionMap } from "$sb/types.ts";
import { builtinFunctions } from "$sb/lib/builtin_query_functions.ts";
import { System } from "../plugos/system.ts";

export function buildQueryFunctions(
  allKnownPages: Set<string>,
  system: System<any>,
): FunctionMap {
  return {
    ...builtinFunctions,
    pageExists: (_globals, name: string) => {
      if (name.startsWith("!") || name.startsWith("{{")) {
        // Let's assume federated pages exist, and ignore template variable ones
        return true;
      }
      return allKnownPages.has(name);
    },
    query: (_globals, query: string, ...args: any) => {
      const encodedArgs: string[] = [];
      for (const arg of args) {
        encodedArgs.push(JSON.stringify(arg));
      }
      // Replace each ? with the next argument
      let i = 0;
      query = query.replaceAll(/\?/g, () => {
        return encodedArgs[i++];
      });
      console.log("Generated query", query);
      return system.invokeFunction("query.query", [query]);
    },
  };
}
