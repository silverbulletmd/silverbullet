export type StructuredDescription = {
  label?: string;
  text: string;
  highlights?: [number, number][];
};

export type Description = string | StructuredDescription;

export function normalizeDescription(value: unknown): Description | undefined {
  if (typeof value === "string") return value;
  if (
    !value ||
    typeof value !== "object" ||
    !("text" in value) ||
    typeof value.text !== "string"
  )
    return undefined;
  const text = value.text;
  const boundary = (offset: number) =>
    !(
      offset > 0 &&
      offset < text.length &&
      /[\uD800-\uDBFF]/.test(text[offset - 1]) &&
      /[\uDC00-\uDFFF]/.test(text[offset])
    );
  const ranges =
    "highlights" in value && Array.isArray(value.highlights)
      ? value.highlights
      : [];
  const valid = ranges
    .filter(
      (range): range is [number, number] =>
        Array.isArray(range) &&
        range.length === 2 &&
        range.every(Number.isInteger) &&
        range[0] >= 0 &&
        range[1] <= text.length &&
        range[0] < range[1] &&
        boundary(range[0]) &&
        boundary(range[1]),
    )
    .sort((a, b) => a[0] - b[0]);
  const highlights: [number, number][] = [];
  for (const [start, end] of valid) {
    const previous = highlights.at(-1);
    if (previous && start <= previous[1])
      previous[1] = Math.max(previous[1], end);
    else highlights.push([start, end]);
  }
  return {
    text,
    ...("label" in value && typeof value.label === "string"
      ? { label: value.label }
      : {}),
    highlights,
  };
}

export function descriptionText(description?: Description): string {
  if (typeof description === "string") return description;
  return description
    ? [description.label, description.text].filter(Boolean).join(" ")
    : "";
}
