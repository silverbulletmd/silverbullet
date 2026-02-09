import type { FilterOption } from "@silverbulletmd/silverbullet/type/client";
import { assertEquals } from "@std/assert";
import { fuzzySearchAndSort } from "./fuse_search.ts";

Deno.test("testFuzzyFilter", () => {
  const array: FilterOption[] = [
    { name: "My Company/Hank", orderId: 2 },
    { name: "My Company/Hane", orderId: 1 },
    { name: "My Company/Steve Co" },
    { name: "Other/Steve" },
    { name: "Steve" },
  ];

  // Prioritize match in last path part
  let results = fuzzySearchAndSort(array, "");
  assertEquals(results.length, array.length);
  results = fuzzySearchAndSort(array, "Steve");
  assertEquals(results.length, 3);
  results = fuzzySearchAndSort(array, "Co");
  // Match in last path part
  assertEquals(results[0].name, "My Company/Steve Co");
  // Due to orderId
  assertEquals(results[1].name, "My Company/Hane");
  assertEquals(results[2].name, "My Company/Hank");
});

Deno.test("Fuzzy search edge case testing", () => {
  // Test edge case where aspiring pages (Infinity orderId) sort last without NaN
  const array: FilterOption[] = [
    { name: "Existing", orderId: 1 },
    { name: "Aspiring A", orderId: Infinity },
    { name: "Aspiring B", orderId: Infinity },
  ];
  const results = fuzzySearchAndSort(array, "");
  assertEquals(results.length, 3);
  assertEquals(results[0].name, "Existing");
  // Both aspiring pages last; relative order between them is stable (no NaN)
  assertEquals(results[1].name, "Aspiring A");
  assertEquals(results[2].name, "Aspiring B");
});
