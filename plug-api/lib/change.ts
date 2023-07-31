// API for working with changes to document text

/** Denotes a region in the document, based on indicices
 */
export type Range = {
  /** The starting index of the span, 0-based, inclusive
   */
  from: number;

  /** The ending index of the span, 0-based, exclusive
   */
  to: number;
};

/** A modification to the document */
export type TextChange = {
  /** The new text */
  inserted: string;

  /** The modified range **before** this change took effect.
   *
   * Example: "aaabbbccc" => "aaaccc", oldRange is [3, 6)
   */
  oldRange: Range;

  /** The modified range **after** this change took effect.
   *
   * Example: "aaabbbccc" => "aaaccc", newRange is [3, 3)
   */
  newRange: Range;
};

/** Get this distance between the start and end of a range */
export function rangeLength(range: Range): number {
  return range.to - range.from;
}
