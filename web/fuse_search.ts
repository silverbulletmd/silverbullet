// @deno-types="https://deno.land/x/fuse@v6.4.1/dist/fuse.d.ts"
import Fuse from "fuse";
import type { FilterOption } from "@silverbulletmd/silverbullet/type/client";

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
    return {
      ...item,
      // Only relevant for pages and or documents and not commands
      baseName: item.name.split("/").pop()!,
      displayName: item?.meta?.displayName,
      aliases: item?.meta?.aliases?.join(" "),
      category: item.category,
    };
  });

  const fuse = new Fuse(enrichedArr, {
    keys: [{
      name: "name",
      weight: 0.3,
    }, {
      name: "baseName",
      weight: 1,
    }, {
      name: "displayName",
      weight: 0.7,
    }, {
      name: "aliases",
      weight: 0.5,
    }, {
      name: "description",
      weight: 0.3,
    }, {
      name: "category",
      weight: 0.8,
    }],
    includeScore: true,
    shouldSort: true,
    isCaseSensitive: false,
    ignoreLocation: true,
    threshold: 0.6,
    sortFn: (a, b): number => {
      const aItem = enrichedArr[a.idx];
      const bItem = enrichedArr[b.idx];

      // Check for exact category matches first
      const searchLower = searchPhrase.toLowerCase();
      const aExactCategoryMatch = aItem.category?.toLowerCase() === searchLower;
      const bExactCategoryMatch = bItem.category?.toLowerCase() === searchLower;

      if (aExactCategoryMatch && !bExactCategoryMatch) {
        return -1; // a comes first
      }
      if (!aExactCategoryMatch && bExactCategoryMatch) {
        return 1; // b comes first
      }

      // If both or neither have exact category matches, use normal scoring
      if (a.score === b.score) {
        const aOrder = aItem.orderId || 0;
        const bOrder = bItem.orderId || 0;
        if (aOrder !== bOrder) {
          return aOrder - bOrder;
        }
      }
      return a.score - b.score;
    },
  });

  const results = fuse.search(searchPhrase);
  return results.map((r) => ({
    ...r.item,
    fuseScore: r.score,
  }));
};
