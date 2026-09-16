import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { expect, test, vi } from "vitest";
import type { Client } from "../../../client.ts";
import type { ViewMeta } from "../../types.ts";
import { DocumentRowsBody } from "./document_view.tsx";

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
