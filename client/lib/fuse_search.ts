import Fuse, { type FuseResultMatch } from "fuse";
import type { FilterOption } from "@silverbulletmd/silverbullet/type/client";
import { fileName } from "@silverbulletmd/silverbullet/lib/resolve";

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
      baseName: fileName(item.name),
      displayName: item?.meta?.displayName,
      aliases: item?.meta?.aliases?.join(" "),
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
    }],
    isCaseSensitive: false,
    ignoreDiacritics: true,
    shouldSort: true,
    threshold: 0.6,
    includeScore: true,
    sortFn: (a, b): number => {
      const aItem = enrichedArr[a.idx];
      const bItem = enrichedArr[b.idx];

      // If scores are the same, use orderId for sorting
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
  const enhancedResults = results.map((r) => ({
    ...r.item,
    fuseScore: r.score,
  }));
  return enhancedResults;
};
