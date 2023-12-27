import {
  clientStore,
  editor,
  markdown,
  system,
} from "$sb/silverbullet-syscall/mod.ts";
import { renderToText, traverseTree, traverseTreeAsync } from "$sb/lib/tree.ts";
import { CodeWidgetContent } from "$sb/types.ts";

const hideTOCKey = "hideTOC";
const headerThreshold = 3;

type Header = {
  name: string;
  pos: number;
  level: number;
};

let cachedTOC: string | undefined;

export async function toggleTOC() {
  cachedTOC = undefined;
  let hideTOC = await clientStore.get(hideTOCKey);
  hideTOC = !hideTOC;
  await clientStore.set(hideTOCKey, hideTOC);
  await renderTOC(); // This will hide it if needed
}

async function markdownToHtml(text: string): Promise<string> {
  return system.invokeFunction("markdown.markdownToHtml", text);
}

export async function renderTOC(
  reload = false,
): Promise<CodeWidgetContent | null> {
  if (await clientStore.get(hideTOCKey)) {
    return null;
  }
  const page = await editor.getCurrentPage();
  const text = await editor.getText();
  const tree = await markdown.parseMarkdown(text);
  const headers: Header[] = [];
  await traverseTreeAsync(tree, async (n) => {
    if (n.type?.startsWith("ATXHeading")) {
      headers.push({
        name: n.children!.slice(1).map(renderToText).join("").trim(),
        pos: n.from!,
        level: +n.type[n.type.length - 1],
      });

      return true;
    }
    return false;
  });
  if (headers.length < headerThreshold) {
    console.log("Not enough headers, not showing TOC", headers.length);
    return null;
  }
  // console.log("Headers", headers);
  const renderedMd = "# Table of Contents\n" +
    headers.map((header) =>
      `${
        " ".repeat((header.level - 1) * 2)
      }* [[${page}@${header.pos}|${header.name}]]`
    ).join("\n");
  // console.log("Markdown", renderedMd);
  return {
    markdown: renderedMd,
  };
}
