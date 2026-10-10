import { expect, test } from "vitest";
import { makeLiveSource, makeStaticSource } from "./live_rewrite.ts";

test("make live wraps, make static unwraps", () => {
  expect(makeLiveSource(' query[[from index.tag "task"]] ')).toBe(
    'widget.live(query[[from index.tag "task"]])',
  );
  expect(makeStaticSource('widget.live(#query[[from index.tag "task"]])')).toBe(
    '#query[[from index.tag "task"]]',
  );
  expect(makeStaticSource(' widget.live( q(), { "edit" } ) ')).toBe("q()");
  expect(makeStaticSource("q()")).toBeUndefined();
  expect(makeStaticSource("widget.live(")).toBeUndefined();
});

test("make live keeps a trailing line comment from swallowing the paren", () => {
  const live = makeLiveSource("q() -- open tasks");
  expect(live).toBe("widget.live(q() -- open tasks\n)");
  expect(makeStaticSource(live)).toBe("q() -- open tasks\n");
});
