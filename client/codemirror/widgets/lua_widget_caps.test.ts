import { expect, test } from "vitest";
import { widgetCaps } from "./lua_widget.ts";

const shown = {
  kind: "markdown" as const,
  bakeable: true,
  copyable: true,
  luaError: false,
};

test("assignment directives can't be baked or toggled live", () => {
  const caps = widgetCaps(
    { kind: "directive", wrappers: [], label: "salary" },
    shown,
    { readOnly: false, expr: "salary = 500" },
  );
  expect(caps.bake).toBe(false);
  expect(caps.toggleLive).toBeUndefined();
});

test("plain directives keep bake and live toggle", () => {
  const caps = widgetCaps({ kind: "directive", wrappers: [] }, shown, {
    readOnly: false,
    expr: "1 + 1",
  });
  expect(caps.bake).toBe(true);
  expect(caps.toggleLive).toBe("makeLive");
});
