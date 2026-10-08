import { expect, test, vi } from "vitest";
import type { Client } from "../../../client.ts";

const expandMarkdown = vi.hoisted(() => vi.fn());

// No DOM here: keep rendered HTML as a string, and spy on the evaluating
// expansion so a literal render can prove it never ran.
vi.mock("../../../codemirror/lua_widget.ts", () => ({
  parseHtmlString: (html: string) => html,
}));
vi.mock("../../../markdown_renderer/inline.ts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  expandMarkdown,
}));

const { renderContentResult } = await import("./content_view.tsx");

const client = {
  config: { get: (_key: string, fallback: unknown) => fallback },
  ui: { viewState: { allPages: [] } },
  currentName: () => "Here",
} as unknown as Client;

test("a content widget with evaluate = false renders its markdown literally", async () => {
  const state = await renderContentResult(
    client,
    {
      widget: {
        markdown: "Total: ${1 + 1} and ![[Secret]] and **bold**",
        evaluate: false,
      },
    },
    "Here",
  );
  expect(expandMarkdown).not.toHaveBeenCalled();
  const html = state.node as unknown as string;
  expect(html).toContain("${1 + 1}");
  expect(html).toContain("Secret");
  expect(html).toContain("<strong>bold</strong>");
});
