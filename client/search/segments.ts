import type { SearchScope } from "../../plug-api/types/search.ts";
import { type PageInfo, pageScopes } from "../navigator/views/pages.ts";

export type { PageInfo };

export type PageSelection = { include?: string[]; exclude?: string[] };

/** Pages sends the (small) complement instead of every content page name. */
export function selectionForScope(
  scope: SearchScope | undefined,
  pages: PageInfo[],
): PageSelection | undefined {
  switch (scope) {
    case "pages":
      return {
        exclude: pages.filter((p) => !pageScopes.pages(p)).map((p) => p.name),
      };
    case "meta":
      return {
        include: pages.filter(pageScopes.meta).map((p) => p.name),
      };
    default:
      return undefined;
  }
}
