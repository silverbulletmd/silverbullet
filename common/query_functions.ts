import { FunctionMap } from "../type/types.ts";
import { builtinFunctions } from "../lib/builtin_query_functions.ts";
import { System } from "../plugos/system.ts";
import { Query } from "../type/types.ts";
import { LimitedMap } from "$lib/limited_map.ts";

const pageCacheTtl = 10 * 1000; // 10s

export function buildQueryFunctions(
  allKnownPages: Set<string>,
  system: System<any>,
): FunctionMap {
  const pageCache = new LimitedMap<string>(10);

  return {
    ...builtinFunctions,
    pageExists(name: string) {
      if (name.startsWith("!") || name.startsWith("{{")) {
        // Let's assume federated pages exist, and ignore template variable ones
        return true;
      }
      return allKnownPages.has(name);
    },
    async template(template: string, obj: any) {
      return (await system.invokeFunction("template.renderTemplate", [
        template,
        obj,
      ])).text;
    },
    // INTERNAL: Used for implementing the { query } syntax in expressions
    $query(query: Query, variables: Record<string, any>) {
      return system.invokeFunction("query.renderQuery", [
        query,
        variables,
      ]);
    },
    // INTERNAL: Used to implement resolving [[links]] in expressions
    readPage(name: string): Promise<string> | string {
      const cachedPage = pageCache.get(name);
      if (cachedPage) {
        return cachedPage;
      } else {
        return system.localSyscall("space.readPage", [name]).then((page) => {
          pageCache.set(name, page, pageCacheTtl);
          return page;
        }).catch((e: any) => {
          if (e.message === "Not found") {
            throw new Error(`Page not found: ${name}`);
          }
        });
      }
    },
  };
}
