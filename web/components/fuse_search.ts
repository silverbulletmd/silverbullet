// @deno-types="https://deno.land/x/fuse@v6.4.1/dist/fuse.d.ts"
import Fuse from "https://deno.land/x/fuse@v6.4.1/dist/fuse.esm.min.js";
import { FilterOption } from "../types.ts";

type FuseOption = FilterOption & {
  baseName: string;
};

export const fuzzySearchAndSort = (
  arr: FilterOption[],
  searchPhrase: string,
): FilterOption[] => {
  if (!searchPhrase) {
    return arr.sort((a, b) => (a.orderId || 0) - (b.orderId || 0));
  }
  const enrichedArr: FuseOption[] = arr.map((item) => {
    return { ...item, baseName: item.name.split("/").pop()! };
  });
  const fuse = new Fuse(enrichedArr, {
    keys: [{
      name: "name",
      weight: 0.3,
    }, {
      name: "baseName",
      weight: 0.7,
    }],
    includeScore: true,
    shouldSort: true,
    isCaseSensitive: false,
    threshold: 0.6,
    sortFn: (a, b): number => {
      //   console.log(a, b);
      if (a.score === b.score) {
        const aOrder = enrichedArr[a.idx].orderId || 0;
        const bOrder = enrichedArr[b.idx].orderId || 0;
        if (aOrder !== bOrder) {
          return aOrder - bOrder;
        }
      }
      return a.score - b.score;
    },
  });

  const results = fuse.search(searchPhrase);
  // console.log("results", results);
  return results.map((r) => r.item);
};
