import { expect, test } from "vitest";
import { bindWidgetEvents, widgetBody } from "./widget_body.ts";

test("html wins over markdown and keeps markdown as copy text", () => {
  expect(
    widgetBody({ html: "<b>x</b>", markdown: "x", display: "block" }),
  ).toEqual({ kind: "html", html: "<b>x</b>", copyMarkdown: "x", block: true });
});

test("html without markdown has no copy text and is inline by default", () => {
  expect(widgetBody({ html: "<b>x</b>" })).toEqual({
    kind: "html",
    html: "<b>x</b>",
    copyMarkdown: undefined,
    block: false,
  });
});

test("markdown-only widgets render markdown", () => {
  expect(widgetBody({ markdown: "# hi", display: "block" })).toEqual({
    kind: "markdown",
    markdown: "# hi",
    block: true,
    evaluate: true,
  });
});

test("evaluate = false is carried to the markdown body", () => {
  expect(widgetBody({ markdown: "${x}", evaluate: false })).toEqual({
    kind: "markdown",
    markdown: "${x}",
    block: false,
    evaluate: false,
  });
});

test("a widget with neither is empty", () => {
  expect(widgetBody({ cssClasses: ["fixture-note"] })).toEqual({
    kind: "empty",
  });
  expect(widgetBody({ markdown: "" })).toEqual({ kind: "empty" });
});

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
