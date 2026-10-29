import { expect, test } from "vitest";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { FilterList, newEntry, offerNewEntry } from "./filter.tsx";

function render(props: Partial<Parameters<typeof FilterList>[0]> = {}) {
  return renderToString(
    h(FilterList, {
      label: "SilverBullet space",
      placeholder: "Pick one",
      helpText: "",
      onSelect: () => {},
      options: [
        { name: "Alpha", description: "First space", hint: "Current" },
        { name: "Beta", hint: "Old", hintInactive: true, cssClass: "festive" },
      ],
      ...props,
    }),
  );
}

test("filter box uses the page picker's (navigator) structure", () => {
  const html = render();
  expect(html).toContain('class="sb-nav-root sb-nav-root-modal sb-filter-box"');
  expect(html).toMatch(
    /<div class="sb-nav-header"><div class="sb-nav-header-row"><label class="sb-nav-title">SilverBullet space<\/label><input/,
  );
  // A borderless navigator input, not the bordered form `.sb-input`
  expect(html).toMatch(/<input[^>]*class="sb-nav-input"/);
  expect(html).not.toContain("sb-input");
  expect(html).toContain('placeholder="Pick one"');
  expect(html).toContain('<div class="sb-nav-body sb-result-list"');
});

test("filter box rows render like navigator rows", () => {
  const html = render();
  // First row selected; legacy option classes kept as hooks for user CSS
  expect(html).toMatch(
    /<div class="sb-nav-row sb-nav-selected sb-option sb-selected-option"[^>]*><span class="sb-nav-primary">Alpha<\/span><span class="sb-nav-description" dir="auto">First space<\/span><span class="sb-nav-chip sb-nav-chip-hint">Current<\/span><\/div>/,
  );
  expect(html).toMatch(
    /<div class="sb-nav-row sb-option sb-decorated-object festive"[^>]*><span class="sb-nav-primary">Beta<\/span><span class="sb-nav-chip sb-nav-chip-hint sb-nav-chip-inactive">Old<\/span><\/div>/,
  );
});

test("filter box shows help text in the navigator help row only when given", () => {
  expect(render()).not.toContain("sb-nav-help");
  expect(render({ helpText: "Select <b>one</b>" })).toContain(
    '<div class="sb-nav-help">Select <b>one</b></div>',
  );
});

test("a typed name that matches no option is offered second, marked new", () => {
  const results = offerNewEntry(
    [{ name: "aliases" }, { name: "authors" }],
    "rating",
    "Add",
  );
  expect(results).toEqual([
    { name: "aliases" },
    { name: "rating", hint: "Add", isNew: true },
    { name: "authors" },
  ]);
  expect(offerNewEntry([], "rating", "Add")).toEqual([
    { name: "rating", hint: "Add", isNew: true },
  ]);
});

test("an exact match or an empty phrase offers no new entry", () => {
  expect(offerNewEntry([{ name: "rating" }], "rating", "Add")).toEqual([
    { name: "rating" },
  ]);
  expect(offerNewEntry([{ name: "rating" }], "", "Add")).toEqual([
    { name: "rating" },
  ]);
});

test("Shift-Enter's entry is marked new and claims no type", () => {
  expect(newEntry("rating")).toEqual({ name: "rating", isNew: true });
});
