import { FilterOption } from "$lib/web.ts";
import { assertEquals } from "$std/testing/asserts.ts";
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
