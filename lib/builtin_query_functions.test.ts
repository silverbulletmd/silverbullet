import { describe, it } from "$std/testing/bdd.ts";
import { builtinFunctions } from "./builtin_query_functions.ts";
import { assertEquals, assertThrows } from "$std/testing/asserts.ts";

describe("replace()", () => {
  const { replace } = builtinFunctions;

  describe("Exceptions", () => {
    const invalidValues = [/hello/, 1, null, undefined, true, {}];

    for (const value of invalidValues) {
      it(`should throw if str is ${value}`, () => {
        assertThrows(
          () => replace(value),
          Error,
          "replace(): str is not a string",
        );
      });
    }

    for (const value of invalidValues.slice(1)) {
      it(`should throw if matcher is ${value}`, () => {
        assertThrows(
          () => replace("input", value, "replaced"),
          Error,
          "replace(): match is not a string or regexp",
        );
      });
    }

    for (const value of invalidValues) {
      it(`should throw if replace is ${value}`, () => {
        assertThrows(
          () => replace("input", /in/, value),
          Error,
          "replace(): replace is not a string",
        );
      });
    }

    it("should throw if replacementPairs is odd", () => {
      assertThrows(
        () => replace("input", /hello/),
        Error,
        "replace(): requires an even number of replacement arguments",
      );
    });
  });

  it("should work with regexp match", () => {
    const output = replace("input", ["in"], "out");
    assertEquals(output, "output");
  });

  it("should work with case-insensitive regexp match", () => {
    const output1 = replace("Input", ["in"], "out");
    assertEquals(output1, "Input");

    const output2 = replace("Input", ["in", "i"], "out");
    assertEquals(output2, "output");
  });

  it("should work with string match", () => {
    const output = replace("input", "in", "out");
    assertEquals(output, "output");
  });

  it("should not work with case-insensitive string match", () => {
    const output = replace("Input", "in", "out");
    assertEquals(output, "Input");
  });

  it("should work with multiple match and replace", () => {
    const output = replace("input", "in", "Hello ", ["put"], "WoRlD", [
      "world",
      "i",
    ], "World");
    assertEquals(output, "Hello World");
  });
});

describe("niceDate", () => {
  const { niceDate } = builtinFunctions;

  const invalidValues = [
    /hello/,
    null,
    undefined,
    true,
    {},
    "invalid",
  ];
  for (const value of invalidValues) {
    it(`should throw if ts is ${value}`, () => {
      assertThrows(
        () => niceDate(value),
        Error,
        "niceDate(): ts is not a valid date",
      );
    });

    const validValues = [
      1704067200000,
      "2024-01-01",
      "01/01/2024",
      new Date("2024-01-01"),
    ];
    for (const value of validValues) {
      it(`should display a nice date given ${value}`, () => {
        assertEquals(niceDate(value), "2024-01-01");
      });
    }
  }
});

describe("escapeRegexp", () => {
  const { escapeRegexp } = builtinFunctions;

  const invalidValues = [/hello/, 1, null, undefined, true, {}];
  for (const value of invalidValues) {
    it(`should throw if ts is ${value}`, () => {
      assertThrows(
        () => escapeRegexp(value),
        Error,
        "escapeRegexp(): ts is not a string",
      );
    });
  }

  it("should escape regexp characters", () => {
    assertEquals(
      escapeRegexp("[-\/\\^$*+?.(Hello)|[\]{}]"),
      "\\[\\-\\/\\\\\\^\\$\\*\\+\\?\\.\\(Hello\\)\\|\\[\\]\\{\\}\\]",
    );
  });
});
