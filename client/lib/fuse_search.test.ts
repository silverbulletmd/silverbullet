import { expect, test } from "vitest";
import type { FilterOption } from "@silverbulletmd/silverbullet/type/client";
import { fuzzySearchAndSort } from "./fuse_search.ts";

test("testFuzzyFilter", () => {
  const array: FilterOption[] = [
    { name: "My Company/Hank", orderId: 2 },
    { name: "My Company/Hane", orderId: 1 },
    { name: "My Company/Steve Co" },
    { name: "Other/Steve" },
    { name: "Steve" },
  ];

  // Prioritize match in last path part
  let results = fuzzySearchAndSort(array, "");
  expect(results.length).toEqual(array.length);
  results = fuzzySearchAndSort(array, "Steve");
  expect(results.length).toEqual(3);
  results = fuzzySearchAndSort(array, "Co");
  // Match in last path part
  expect(results[0].name).toEqual("My Company/Steve Co");
  // Due to orderId
  expect(results[1].name).toEqual("My Company/Hane");
  expect(results[2].name).toEqual("My Company/Hank");
});

test("Fuzzy search edge case testing", () => {
  // Test edge case where aspiring pages (Infinity orderId) sort last without NaN
  const array: FilterOption[] = [
    { name: "Existing", orderId: 1 },
    { name: "Aspiring A", orderId: Infinity },
    { name: "Aspiring B", orderId: Infinity },
  ];
  const results = fuzzySearchAndSort(array, "");
  expect(results.length).toEqual(3);
  expect(results[0].name).toEqual("Existing");
  // Both aspiring pages last; relative order between them is stable (no NaN)
  expect(results[1].name).toEqual("Aspiring A");
  expect(results[2].name).toEqual("Aspiring B");
});
