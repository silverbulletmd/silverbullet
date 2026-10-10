// Lets low-level runtime code recognise view values without depending on the
// navigator, not even for types: `navigator/view_value.ts` narrows on top of it.
export const VIEW_VALUE_MARK: unique symbol = Symbol.for("sb.viewValue");

export function hasViewMark(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !!(value as { [VIEW_VALUE_MARK]?: true })[VIEW_VALUE_MARK]
  );
}
