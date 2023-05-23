import { FilterOption } from "../types.ts";

export const fuzzySearchAndSort = (
  arr: FilterOption[],
  searchPhrase: string,
): FilterOption[] => {
  // Prepare regular expression: escape special characters, add '.*' around each character
  const safePhrase = searchPhrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // escape special characters
  const searchRegex = new RegExp(Array.from(safePhrase).join(".*"), "i"); // 'i' makes it case-insensitive

  // Fuzzy matching on name using the regular expression
  const filtered = arr.filter((item) => searchRegex.test(item.name));

  // Sorting by exact match, whether match is in part after '/', then by orderId
  filtered.sort((a, b) => {
    const aNamePart = a.name.includes("/")
      ? a.name.split("/").pop() || ""
      : a.name;
    const bNamePart = b.name.includes("/")
      ? b.name.split("/").pop() || ""
      : b.name;

    const aMatchInPart = searchRegex.test(aNamePart);
    const bMatchInPart = searchRegex.test(bNamePart);

    // Check for exact match
    const aExactMatch = a.name.toLowerCase() === searchPhrase.toLowerCase();
    const bExactMatch = b.name.toLowerCase() === searchPhrase.toLowerCase();

    if (aExactMatch !== bExactMatch) {
      // If one is an exact match and the other is not, prioritize the exact match
      return aExactMatch ? -1 : 1;
    } else if (aMatchInPart !== bMatchInPart) {
      // If one matches in the part after '/' and the other doesn't, prioritize the one that does
      return aMatchInPart ? -1 : 1;
    } else {
      // If both match in the same part of name, prioritize by orderId
      const aOrder = a.orderId !== undefined ? a.orderId : Infinity;
      const bOrder = b.orderId !== undefined ? b.orderId : Infinity;
      return aOrder - bOrder;
    }
  });

  return filtered;
};
