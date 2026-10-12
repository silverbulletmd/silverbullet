import { expect, test } from "vitest";
import { widgetCaps } from "./lua_widget.ts";

const shown = {
  kind: "markdown" as const,
  bakeable: true,
  copyable: true,
  luaError: false,
};

test("assignment directives can't be baked", () => {
  const caps = widgetCaps(
    { kind: "directive", wrappers: [], label: "salary" },
    shown,
    { readOnly: false },
  );
  expect(caps.bake).toBe(false);
});

test("plain directives keep bake", () => {
  const caps = widgetCaps({ kind: "directive", wrappers: [] }, shown, {
    readOnly: false,
  });
  expect(caps.bake).toBe(true);
});
