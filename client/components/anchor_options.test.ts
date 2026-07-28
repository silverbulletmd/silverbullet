import { expect, test } from "vitest";
import {
  type AnchorObject,
  anchorDescription,
  anchorOrderId,
  anchorsToFilterOptions,
  anchorToFilterOption,
} from "./anchor_options.ts";
import { fuzzySearchAndSort } from "../lib/fuzzy_search.ts";

const base: AnchorObject = {
  ref: "rent",
  page: "Finances",
  hostTag: "task",
  snippet: "- [ ] $rent Pay rent by the 1st",
  pageLastModified: "2026-07-02T12:00:00Z",
};

test("option name carries the $ so the typed phrase matches it directly", () => {
  expect(anchorToFilterOption(base).name).toBe("$rent");
});

test("description is the snippet's first line plus the page", () => {
  expect(anchorDescription(base)).toBe(
    "- [ ] $rent Pay rent by the 1st — Finances",
  );
});

test("description uses only the first line of a multi-line snippet", () => {
  const multi = { ...base, snippet: "- Item $ii\n  - child one\n  - child two" };
  expect(anchorDescription(multi)).toBe("- Item $ii — Finances");
});

test("description truncates a very long first line", () => {
  const long = { ...base, snippet: "x".repeat(200) };
  const description = anchorDescription(long);
  expect(description).toContain("…");
  expect(description.length).toBeLessThan(140);
});

test("description falls back to hostTag + page when there is no snippet", () => {
  const { snippet: _snippet, ...noSnippet } = base;
  expect(anchorDescription(noSnippet)).toBe("task on Finances");
});

test("orderId is the negated page timestamp, so newer sorts first", () => {
  expect(anchorOrderId(base)).toBe(-new Date(base.pageLastModified!).getTime());
});

test("orderId is undefined when pageLastModified is absent", () => {
  const { pageLastModified: _lm, ...legacy } = base;
  expect(anchorOrderId(legacy)).toBeUndefined();
});

test("orderId is undefined for an unparseable timestamp rather than NaN", () => {
  expect(anchorOrderId({ ...base, pageLastModified: "not a date" })).toBe(
    undefined,
  );
});

test("legacy records without the new fields don't corrupt the sort order", () => {
  // The shape a pre-existing index produces: no snippet, no timestamp.
  const legacy: AnchorObject = {
    ref: "old",
    page: "Ancient",
    hostTag: "paragraph",
  };
  const older: AnchorObject = {
    ...base,
    ref: "older",
    pageLastModified: "2020-01-01T00:00:00Z",
  };
  const newer: AnchorObject = {
    ...base,
    ref: "newer",
    pageLastModified: "2026-07-05T00:00:00Z",
  };

  // "$" matches every anchor name equally, so ordering falls through to
  // orderId — exactly what the picker does when only "$" has been typed.
  const sorted = fuzzySearchAndSort(
    anchorsToFilterOptions([legacy, older, newer]),
    "$",
  );
  const names = sorted.map((o) => o.name);

  // The timestamped rows must still be correctly ordered relative to each
  // other; a NaN orderId would scramble this.
  expect(names.indexOf("$newer")).toBeLessThan(names.indexOf("$older"));
  // And the legacy row is still present and reachable.
  expect(names).toContain("$old");
});
