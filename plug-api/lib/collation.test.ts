import { expect, test } from "vitest";
import { compareCollated } from "./collation.ts";

test("compareCollated: disabled collation falls back to raw codepoint order", () => {
  const collator = Intl.Collator(undefined, undefined);
  expect(
    compareCollated("Zeta", "apple", { enabled: false }, collator),
  ).toBeLessThan(0);
  expect(compareCollated("Zeta", "apple", undefined, collator)).toBeLessThan(0);
});

test("compareCollated: enabled collation sorts alphabetically, not by codepoint", () => {
  const collation = { enabled: true, locale: "de" };
  const collator = Intl.Collator(collation.locale, undefined);
  expect(compareCollated("Zeta", "apple", collation, collator)).toBeGreaterThan(
    0,
  );
  expect(compareCollated("apple", "Zeta", collation, collator)).toBeLessThan(0);
});

test("compareCollated: enabled collation still falls back to raw order for non-strings", () => {
  const collation = { enabled: true, locale: "de" };
  const collator = Intl.Collator(collation.locale, undefined);
  expect(compareCollated(2, 10, collation, collator)).toBeLessThan(0);
  expect(compareCollated(10, 2, collation, collator)).toBeGreaterThan(0);
});

test("compareCollated: equal values return 0", () => {
  const collator = Intl.Collator(undefined, undefined);
  expect(compareCollated("same", "same", { enabled: true }, collator)).toBe(0);
  expect(compareCollated(5, 5, undefined, collator)).toBe(0);
});
