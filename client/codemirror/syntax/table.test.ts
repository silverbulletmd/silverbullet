// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";
import { parse } from "../../markdown_parser/parse_tree.ts";
import { extendedMarkdownLanguage } from "../../markdown_parser/parser.ts";

let release!: (v: unknown) => void;
const disposeRendered = vi.fn();
const renderedTrees: unknown[] = [];
vi.mock("../../markdown_renderer/compose.ts", () => ({
  renderMarkdown: (tree: unknown) => {
    renderedTrees.push(tree);
    return new Promise((r) => (release = r));
  },
  disposeRendered: (n: Element) => disposeRendered(n),
}));
vi.mock("../../markdown_renderer/compose_client.ts", () => ({
  liveContextForClient: () => ({}),
}));

const { TableViewWidget } = await import("./table.ts");

function fakeClient() {
  return {
    widgetCache: {
      getCachedWidgetHeight: () => 0,
      setCachedWidgetMeta: vi.fn(),
    },
    editorView: { posAtDOM: () => 0, dispatch: vi.fn() },
    config: { get: (_k: string, d: unknown) => d },
    currentName: () => "Host",
  } as any;
}

test("a table destroyed before rendering finishes is not filled", async () => {
  const tree = parse(extendedMarkdownLanguage, "| a |\n|---|\n| 1 |")
    .children![0];
  const w = new TableViewWidget(fakeClient(), tree);
  const dom = w.toDOM();
  w.destroy(dom);
  const node = document.createElement("span");
  node.innerHTML = "<table></table>";
  release({ node, copyMarkdown: "", empty: false });
  await new Promise((r) => setTimeout(r, 0));
  expect(dom.querySelector("table")).toBeNull();
  expect(disposeRendered).toHaveBeenCalledWith(node);
});

test("each render works on its own copy of the table tree", () => {
  const tree = parse(extendedMarkdownLanguage, "| a |\n|---|\n| 1 |")
    .children![0];
  const w = new TableViewWidget(fakeClient(), tree);
  renderedTrees.length = 0;
  w.toDOM();
  w.toDOM();
  expect(renderedTrees).toHaveLength(2);
  expect(renderedTrees[0]).not.toBe(tree);
  expect(renderedTrees[0]).not.toBe(renderedTrees[1]);
});

test("a table re-shown after being destroyed renders again", async () => {
  const tree = parse(extendedMarkdownLanguage, "| a |\n|---|\n| 1 |")
    .children![0];
  const w = new TableViewWidget(fakeClient(), tree);
  const d1 = w.toDOM();
  w.destroy(d1);
  const d2 = w.toDOM();
  const node = document.createElement("span");
  node.innerHTML = "<table></table>";
  release({ node, copyMarkdown: "", empty: false });
  await new Promise((r) => setTimeout(r, 0));
  expect(d2.querySelector("table")).not.toBeNull();
});
