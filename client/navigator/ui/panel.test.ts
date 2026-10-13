import { expect, test } from "vitest";
import { ctxKey } from "./panel.ts";

test("a dropdown change is a new source invocation", () => {
  expect(ctxKey({ phrase: "fern", dropdown: "regex" })).not.toEqual(
    ctxKey({ phrase: "fern", dropdown: "phrase" }),
  );
  expect(ctxKey({ phrase: "fern" })).toEqual(
    ctxKey({ phrase: "fern", dropdown: undefined }),
  );
});
