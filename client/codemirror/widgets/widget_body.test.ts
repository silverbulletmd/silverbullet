import { expect, test } from "vitest";
import { bindWidgetEvents } from "./widget_body.ts";

test("widget events can be unbound so a re-render does not stack listeners", () => {
  const target = new EventTarget();
  const calls: string[] = [];
  const events = { click: (event: { name: string }) => calls.push(event.name) };

  const unbind = bindWidgetEvents(target, events);
  target.dispatchEvent(new Event("click"));
  unbind();
  bindWidgetEvents(target, events);
  target.dispatchEvent(new Event("click"));

  expect(calls).toEqual(["click", "click"]);
});
