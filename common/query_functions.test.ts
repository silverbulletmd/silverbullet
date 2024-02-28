import { beforeEach, describe, it } from "$std/testing/bdd.ts";
import { buildQueryFunctions } from "$common/query_functions.ts";
import type { System } from "$lib/plugos/system.ts";
import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "$std/testing/asserts.ts";

let functions: ReturnType<typeof buildQueryFunctions>;

beforeEach(() => {
  functions = buildQueryFunctions(
    new Set(["page1"]),
    {} as System<unknown>,
  );
});

describe("pageExists", () => {
  const invalidValues = [/hello/, 1, null, undefined, true, {}];
  for (const value of invalidValues) {
    it(`should throw if name is ${value}`, () => {
      assertThrows(
        () => functions.pageExists(value),
        Error,
        "pageExists(): name is not a string",
      );
    });
  }

  it("should return true if name starts with ! or {{", () => {
    assertEquals(functions.pageExists("!invalid name"), true);
    assertEquals(functions.pageExists("{{invalid name"), true);
  });

  it("should return true if page exists", () => {
    assertEquals(functions.pageExists("page1"), true);
  });

  it("should return false if page doesn't exist", () => {
    assertEquals(functions.pageExists("page2"), false);
  });
});

describe("template", () => {
  const invalidValues = [/hello/, 1, null, undefined, true, {}];
  for (const value of invalidValues) {
    it(`should throw if template is ${value}`, async () => {
      await assertRejects(
        () => functions.template(value),
        Error,
        "template(): template is not a string",
      );
    });
  }
});
