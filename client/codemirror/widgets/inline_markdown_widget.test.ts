// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";

vi.mock("../../markdown_renderer/compose.ts", () => ({
  renderMarkdown: async (md: string) => {
    const node = document.createElement("span");
    node.innerHTML = `<span class="p">${md.replace("${2+3}", "5")}</span>`;
    return { node, copyMarkdown: md, empty: false };
  },
  disposeRendered: () => {},
}));
vi.mock("../../markdown_renderer/compose_client.ts", () => ({
  liveContextForClient: () => ({}),
}));

const { InlineMarkdownWidget } = await import("./inline_markdown_widget.ts");

test("shows the source until the rendered inline markdown replaces it", async () => {
  const w = new InlineMarkdownWidget({} as any, "v ${2+3}");
  const dom = w.toDOM();
  expect(dom.textContent).toBe("v ${2+3}");
  await new Promise((r) => setTimeout(r, 0));
  expect(dom.textContent).toBe("v 5");
  expect(dom.querySelector(".p")).toBeNull();
});
