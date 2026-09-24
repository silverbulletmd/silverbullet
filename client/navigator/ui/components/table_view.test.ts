import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { expect, test, vi } from "vitest";
import type { Client } from "../../../client.ts";
import { TableView } from "./table_view.tsx";

vi.mock("./row_markdown.tsx", () => ({
  MarkdownText: () => null,
  renderRowMarkdown: async () => undefined,
}));
const row = { primary: "Sketchbook", obj: { name: "Sketchbook", count: 3 } };
const props = {
  rows: [row],
  columns: [
    { attribute: "name", label: "Project" },
    { attribute: "count", label: "Count" },
  ],
  client: {} as Client,
};

test("passive tables expose plain headers but no row selection affordances", () => {
  const html = renderToString(h(TableView, props));
  expect(html).toContain("<table");
  expect(html).toContain('scope="col"');
  expect(html).not.toContain("aria-sort");
  expect(html).not.toContain("sb-table-sort");
  expect(html).toContain("Sketchbook");
  expect(html).not.toContain('tabindex="0"');
  expect(html).not.toContain("sb-table-selectable");
  expect(html).not.toContain("sb-nav-selected");
  expect(html).not.toContain("sb-table-actions");
});

test("tables expose selectable rows", () => {
  const html = renderToString(
    h(TableView, {
      ...props,
      onSelect() {},
    }),
  );
  expect(html).toContain('tabindex="0"');
  expect(html).toContain("sb-table-selectable");
});

test("passive tables retain accessible conditional actions and read-only restrictions", () => {
  const html = renderToString(
    h(TableView, {
      ...props,
      actions: [
        { label: "Open", hasWhen: false },
        { label: "Archive", hasWhen: false, requireMode: "rw" },
        { label: "Hidden", hasWhen: true },
      ],
      readOnly: true,
    }),
  );
  expect(html).toContain("sb-table-actions");
  expect(html).toContain('aria-label="Open"');
  expect(html).not.toContain('aria-label="Archive"');
  expect(html).not.toContain('aria-label="Hidden"');
  expect(html).not.toContain("sb-table-selectable");
});

test("typed cells render callback values as booleans, safe URLs, and literal text", () => {
  const html = renderToString(
    h(TableView, {
      ...props,
      rows: [
        {
          primary: "",
          obj: {
            done: true,
            url: "https://example.com/raw",
            text: "raw",
            amount: 1,
          },
          cells: [false, "https://example.com/display", "**literal**", 12],
        },
      ],
      columns: [
        { attribute: "done", label: "Done", type: "boolean" },
        { attribute: "url", label: "URL", type: "url" },
        { attribute: "text", label: "Text", type: "text" },
        { attribute: "amount", label: "Amount", type: "number" },
      ],
    }),
  );
  expect(html).not.toContain('role="img"');
  expect(html).toContain('aria-label="false"');
  expect(html).toContain('type="checkbox"');
  expect(html).toContain('class="sb-checkbox"');
  expect(html).toContain("disabled");
  expect(html).toContain('href="https://example.com/display"');
  expect(html).not.toContain('href="https://example.com/raw"');
  expect(html).toContain("**literal**");
  expect(html).toContain('data-type="number"');
});

test("non-sortable columns use plain headers without sorting controls", () => {
  const html = renderToString(
    h(TableView, {
      ...props,
      columns: [{ attribute: "name", label: "Project" }],
    }),
  );
  expect(html).toContain("Project</th>");
  expect(html).not.toContain("sb-table-sort");
  expect(html).not.toContain("aria-sort");
});
