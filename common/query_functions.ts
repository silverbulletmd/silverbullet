import { FunctionMap, Query } from "$sb/types.ts";
import { builtinFunctions } from "$lib/builtin_query_functions.ts";
import { System } from "$lib/plugos/system.ts";
import { LimitedMap } from "$lib/limited_map.ts";
import { parsePageRef } from "$sb/lib/page_ref.ts";

const pageCacheTtl = 10 * 1000; // 10s

export function buildQueryFunctions(
  allKnownFiles: Set<string>,
  system: System<any>,
): FunctionMap {
  const pageCache = new LimitedMap<string>(10);

  return {
    ...builtinFunctions,
    pageExists(name: string) {
      if (typeof name !== "string") {
        throw new Error("pageExists(): name is not a string");
      }

      if (name.startsWith("!") || name.startsWith("{{")) {
        // Let's assume federated pages exist, and ignore template variable ones
        return true;
      }

      const flattendFiles = new Set(
        [...allKnownFiles].flatMap((file) =>
          (file.endsWith(".md")) ? [file.slice(0, -3)] : []
        ),
      );

      return flattendFiles.has(name);
    },
    async template(template: unknown, obj: unknown) {
      if (typeof template !== "string") {
        throw new Error("template(): template is not a string");
      }

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
    // INTERNAL: Used to implement resolving [[links]] in expressions, also supports [[link#header]] and [[link$pos]] as well as [[link$anchor]]
    async readPage(name: string): Promise<string> {
      const cachedPage = pageCache.get(name);
      if (cachedPage) {
        return cachedPage;
      } else {
        const pageRef = parsePageRef(name);
        try {
          let page: string = await system.localSyscall("space.readPage", [
            pageRef.page,
          ]);

          // Extract page section if pos, anchor, or header are included
          if (pageRef.pos) {
            // If the page link includes a position, slice the page from that position
            page = page.slice(pageRef.pos);
          } else if (pageRef.anchor) {
            // If the page link includes an anchor, slice the page from that anchor
            const pos = page.indexOf(`$${pageRef.anchor}`);
            page = page.slice(pos);
          } else if (pageRef.header) {
            // If the page link includes a header, select that header (up to the next header at the same level)
            // Note: this an approximation, should ideally use the AST
            let pos = page.indexOf(`# ${pageRef.header}\n`);
            let headingLevel = 1;
            while (page.charAt(pos - 1) === "#") {
              pos--;
              headingLevel++;
            }
            page = page.slice(pos);

            // Slice up to the next equal or higher level heading
            const headRegex = new RegExp(
              `[^#]#{1,${headingLevel}} [^\n]*\n`,
              "g",
            );
            const endPos = page.slice(headingLevel).search(headRegex) +
              headingLevel;
            if (endPos) {
              page = page.slice(0, endPos);
            }
          }

          pageCache.set(name, page, pageCacheTtl);

          return page;
        } catch (e: any) {
          if (e.message === "Not found") {
            throw new Error(`Page not found: ${name}`);
          }
          throw e;
        }
      }
    },
  };
}
