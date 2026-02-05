import Fuse from "fuse";
import type { FilterOption } from "@silverbulletmd/silverbullet/type/client";
import { fileName } from "@silverbulletmd/silverbullet/lib/resolve";

type FuseOption = FilterOption & {
  baseName: string;
};

/**
 * Compare orderIds; aspiring pages (Infinity) sort last. Avoids NaN when both are Infinity.
 * @returns -1 if a is less than b, 1 if a is greater than b, 0 if they are equal
 */
function compareOrderId(a: number | undefined, b: number | undefined): number {
  const aOrder = a ?? 0;
  const bOrder = b ?? 0;
  if (aOrder === Infinity && bOrder === Infinity) return 0;
  if (aOrder === Infinity) return 1;
  if (bOrder === Infinity) return -1;
  return aOrder - bOrder;
}

export const fuzzySearchAndSort = (
  arr: FilterOption[],
  searchPhrase: string,
): FilterOption[] => {
  if (!searchPhrase) {
    return arr.sort((a, b) => compareOrderId(a.orderId, b.orderId));
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

      // If either orderId is Infinity (aspiring page), put it last (compareOrderId avoids NaN)
      if (aItem.orderId === Infinity || bItem.orderId === Infinity) {
        return compareOrderId(aItem.orderId, bItem.orderId);
      }

      // If scores are the same, use orderId for sorting
      if (a.score === b.score) {
        const aOrder = aItem.orderId ?? 0;
        const bOrder = bItem.orderId ?? 0;
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
