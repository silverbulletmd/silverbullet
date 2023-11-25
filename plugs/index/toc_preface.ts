import { clientStore, editor, markdown } from "$sb/silverbullet-syscall/mod.ts";
import { renderToText, traverseTree } from "$sb/lib/tree.ts";
import { asset } from "$sb/syscalls.ts";

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

export async function renderTOC(reload = false) {
  if (await clientStore.get(hideTOCKey)) {
    return editor.hidePanel("preface");
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
  // console.log("All headers", headers);
  if (!reload && cachedTOC === JSON.stringify(headers)) {
    console.log("TOC is the same, not updating");
    return;
  }
  cachedTOC = JSON.stringify(headers);
  if (headers.length < headerThreshold) {
    console.log("Not enough headers, not showing TOC", headers.length);
    await editor.hidePanel("preface");
    return;
  }
  let tocMarkdown = "";
  for (const header of headers) {
    tocMarkdown += `${
      " ".repeat(3 * (header.level - 1))
    }* [${header.name}](/${page}@${header.pos})\n`;
  }
  const css = await asset.readAsset("asset/style.css");
  const js = await asset.readAsset("asset/toc.js");

  await editor.showPanel(
    "preface",
    1,
    ` <style>${css}</style>
      <div id="sb-main"><div id="sb-editor"><div class="cm-editor">
      <div id="button-bar">
      <button id="reload-button" title="Reload"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg></button>
      <button id="hide-button" title="Hide TOC"><svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" class="css-i6dzq1"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg></button>
      </div>
      <div class="cm-line sb-line-h2">Table of Contents</div>
      <ul id="link-ul">
      ${
      headers.map((header) =>
        `<li data-ref="${page}@${header.pos}" class="toc-header-${header.level}"><span class="sb-wiki-link-page">${header.name}</span></li>`
      ).join("")
    }
      </ul>
      </div></div></div>
      `,
    js,
  );
}
