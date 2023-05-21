import { FilterOption } from "../types.ts";
import { assertEquals } from "../../test_deps.ts";
import { fuzzySearchAndSort } from "./fuzzy_search.ts";

Deno.test("testFuzzyFilter", () => {
  const array: FilterOption[] = [
    { name: "My Company/Hank", orderId: -5 },
    { name: "My Company/Steve Co", orderId: -5 },
    { name: "Other/Steve", orderId: -7 },
    { name: "Steve", orderId: -3 },
  ];

  // Prioritize match in last path part
  const result = fuzzySearchAndSort(array, "Co");
  assertEquals(result.length, 2);
  assertEquals(result[0].name, "My Company/Steve Co");

  // Support slash matches
  const result2 = fuzzySearchAndSort(array, "Co/St");
  assertEquals(result2.length, 1);
  assertEquals(result2[0].name, "My Company/Steve Co");

  // Find "St" in both, but pioritize based on orderId
  const result3 = fuzzySearchAndSort(array, "St");
  assertEquals(result3.length, 3);
  assertEquals(result3[0].name, "Other/Steve");

  const result4 = fuzzySearchAndSort(array, "Steve");
  assertEquals(result4[0].name, "Steve");

  //   const result2 = fuzzySearchAndSort(array, "");
  //   console.log("Result 2", result2);
  //   assertEquals(result.length, 3);
  //   assertEquals(result[0].orderId, 1);

  //   assertEquals(result[1].name, "Jack");
  //   assertEquals(result[1].orderId, 2);
  //   assertEquals(result[2].name, "Jill");
  //   assertEquals(result[2].orderId, 3);
});
