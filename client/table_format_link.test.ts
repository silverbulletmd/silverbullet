import { expect, test } from "vitest";
import { parseMarkdown } from "./markdown_parser/parser.ts";
import { renderToText } from "../plug-api/lib/tree.ts";
import { loadStdPages } from "./space_lua/std_page_harness_test_util.ts";

async function formatTable(text: string): Promise<string> {
  let output = text;
  const h = await loadStdPages(["libraries/Library/Std/Editor/Table.md"], {
    editor: {
      getCursor: () => 0,
      getText: () => output,
      replaceRange: (from: number, to: number, newText: string) =>
        (output = output.slice(0, from) + newText + output.slice(to)),
      flashNotification: () => undefined,
    },
    markdown: {
      parseMarkdown: (s: string) => parseMarkdown(s),
      renderParseTree: (tree: Parameters<typeof renderToText>[0]) =>
        renderToText(tree),
    },
  });
  await h.commands.get("Table: Format")!();
  return output;
}

test("formatting a table preserves wiki links in cells", async () => {
  const output: string = await formatTable("| foo |\n| --- |\n| [[bar]] |\n");
  expect(output).toContain("[[bar]]");
});

test("formatting a table preserves markdown links in cells", async () => {
  const output: string = await formatTable(
    "| foo |\n| --- |\n| [bar](https://example.com) |\n",
  );
  expect(output).toContain("[bar](https://example.com)");
});
