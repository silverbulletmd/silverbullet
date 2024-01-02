import {
  clientStore,
  codeWidget,
  editor,
  markdown,
} from "$sb/silverbullet-syscall/mod.ts";
import { renderToText, traverseTree } from "$sb/lib/tree.ts";
import { CodeWidgetContent } from "$sb/types.ts";

const hideTOCKey = "hideTOC";
const headerThreshold = 3;

type Header = {
  name: string;
  pos: number;
  level: number;
};

export async function toggleTOC() {
  let hideTOC = await clientStore.get(hideTOCKey);
  hideTOC = !hideTOC;
  await clientStore.set(hideTOCKey, hideTOC);
  await codeWidget.refreshAll();
}

export async function refreshWidgets() {
  await codeWidget.refreshAll();
}

export async function renderTOC(): Promise<CodeWidgetContent | null> {
  if (await clientStore.get(hideTOCKey)) {
    return null;
  }
  const page = await editor.getCurrentPage();
  const text = await editor.getText();
  const tree = await markdown.parseMarkdown(text);
  const headers: Header[] = [];
  traverseTree(tree, (n) => {
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
  // Adjust level down if only sub-headers are used
  const minLevel = headers.reduce(
    (min, header) => Math.min(min, header.level),
    6,
  );
  const renderedMd = "# Table of Contents\n" +
    headers.map((header) =>
      `${
        " ".repeat((header.level - minLevel) * 2)
      }* [[${page}@${header.pos}|${header.name}]]`
    ).join("\n");
  // console.log("Markdown", renderedMd);
  return {
    markdown: renderedMd,
    buttons: [
      {
        description: "Reload",
        svg:
          `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-refresh-cw"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>`,
        invokeFunction: "index.refreshWidgets",
      },
      {
        description: "Hide",
        svg:
          `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-eye-off"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`,
        invokeFunction: "index.toggleTOC",
      },
    ],
  };
}
