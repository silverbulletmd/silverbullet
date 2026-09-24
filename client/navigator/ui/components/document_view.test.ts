import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { expect, test, vi } from "vitest";
import type { Client } from "../../../client.ts";
import type { ViewMeta } from "../../types.ts";
import { DocumentRowsBody, DocumentView } from "./document_view.tsx";

vi.mock("./content_view.tsx", () => ({
  ContentNode: () => null,
  CopyMarkdownButton: () => null,
  renderContentMarkdown: async () => undefined,
}));
vi.mock("./row_markdown.tsx", () => ({
  MarkdownText: () => null,
  renderRows: async () => [],
}));

const meta = {
  mode: "list",
  limit: 20,
  hierarchy: { separator: "/" },
  foldersFirst: true,
  expandAll: false,
} as ViewMeta;
const rows = [{ row: { primary: "A row", obj: { name: "Notes/First" } } }];

test("inline filter input is opt-in for embedded row views", () => {
  const draw = (inlineFilter: boolean) =>
    renderToString(
      h(DocumentView, {
        meta: { ...meta, inlineFilter },
        client: {} as Client,
        pageName: "index",
        dock: "inline",
        dispatch: async () => [],
        selectable: false,
      }),
    );
  expect(draw(true)).toContain('aria-label="Filter view"');
  expect(draw(true)).toContain('class="sb-nav-header sb-inline-view-header"');
  expect(draw(false)).not.toContain('aria-label="Filter view"');
});

test("an inline title uses the panel header with or without filtering", () => {
  const draw = (inlineFilter: boolean) =>
    renderToString(
      h(DocumentView, {
        meta: { ...meta, title: "Projects", inlineFilter },
        client: {} as Client,
        pageName: "index",
        dock: "inline",
        dispatch: async () => [],
        selectable: false,
      }),
    );
  expect(draw(false)).toContain('class="sb-nav-title">Projects</span>');
  expect(draw(false)).not.toContain('aria-label="Filter view"');
  expect(draw(true)).toContain('class="sb-nav-title">Projects</span>');
  expect(draw(true)).toContain('class="sb-nav-input"');
  const content = renderToString(
    h(DocumentView, {
      meta: { ...meta, title: "Notes", hasContent: true },
      client: {} as Client,
      pageName: "index",
      dock: "inline",
      dispatch: async () => [],
      selectable: false,
    }),
  );
  expect(content).toContain('class="sb-nav-title">Notes</span>');
});

test("passive inline rows remain readable without exposing a row button", () => {
  const html = renderToString(
    h(DocumentRowsBody, {
      rows,
      meta,
      client: {} as Client,
      expanded: new Set<string>(),
      onToggle() {},
    }),
  );
  expect(html).toContain("A row");
  expect(html).not.toContain('role="button"');
  expect(html).not.toContain('tabindex="0"');
  expect(html).toContain("sb-page-widget-row");
});

test("selectable document rows expose keyboard activation", () => {
  const html = renderToString(
    h(DocumentRowsBody, {
      rows,
      meta,
      client: {} as Client,
      expanded: new Set<string>(),
      onToggle() {},
      onSelect() {},
    }),
  );
  expect(html).toContain('role="button"');
  expect(html).toContain('tabindex="0"');
});

test("expandAll treats restored paths as collapsed tree exceptions", () => {
  const treeMeta = { ...meta, mode: "tree", expandAll: true } as ViewMeta;
  const treeRows = [
    { row: { primary: "Folder", obj: { name: "Folder" } } },
    { row: { primary: "Child", obj: { name: "Folder/Child" } } },
  ];
  const draw = (expanded: Set<string>) =>
    renderToString(
      h(DocumentRowsBody, {
        rows: treeRows,
        meta: treeMeta,
        client: {} as Client,
        expanded,
        onToggle() {},
      }),
    );
  expect(draw(new Set())).toContain('data-path="Folder/Child"');
  expect(draw(new Set(["Folder"]))).not.toContain('data-path="Folder/Child"');
});

test("document lists render icons, positioned chips, and conditional actions without selection", () => {
  const row = {
    primary: "Sketchbook",
    obj: { name: "Sketchbook" },
    decorations: [
      { text: "Before", position: "left" as const },
      { text: "After", position: "right" as const },
    ],
  };
  const html = renderToString(
    h(DocumentRowsBody, {
      rows: [{ row }],
      meta: {
        ...meta,
        hasRowIcon: true,
        actions: [
          { label: "Complete", hasWhen: true },
          { label: "Delete", hasWhen: true },
        ],
      },
      client: {} as Client,
      expanded: new Set<string>(),
      onToggle() {},
      onAction() {},
      rowState: {
        byRow: new WeakMap([
          [row, { icon: {} as Element, actions: [true, false] }],
        ]),
      },
    }),
  );
  expect(html).toContain('class="sb-nav-icon"');
  expect(html.indexOf("Before")).toBeLessThan(html.indexOf("Sketchbook"));
  expect(html.indexOf("After")).toBeGreaterThan(html.indexOf("Sketchbook"));
  expect(html).toContain('aria-label="Complete"');
  expect(html).not.toContain('aria-label="Delete"');
});
