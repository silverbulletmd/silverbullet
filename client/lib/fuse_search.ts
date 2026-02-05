import Fuse from "fuse";
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
      weight: 2,
    }, {
      name: "baseName",
      weight: 3,
    }, {
      name: "displayName",
      weight: 2,
    }, {
      name: "aliases",
      weight: 2,
    }, {
      name: "description",
      weight: 1,
    }],
    isCaseSensitive: false,
    ignoreDiacritics: true,
    shouldSort: true,
    threshold: 0.3,
    includeScore: true,
    sortFn: (a, b): number => {
      const aItem = enrichedArr[a.idx];
      const bItem = enrichedArr[b.idx];

      // If either aItem.orderId or bItem.orderId is Infinity (== aspiring page), put it last
      if (aItem.orderId === Infinity || bItem.orderId === Infinity) {
        return (aItem.orderId || 0) - (bItem.orderId || 0);
      }

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
