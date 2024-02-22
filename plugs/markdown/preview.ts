import { asset, clientStore, editor, markdown, system } from "$sb/syscalls.ts";
import { renderMarkdownToHtml } from "./markdown_render.ts";
import { resolveAttachmentPath } from "$sb/lib/resolve.ts";
import { expandCodeWidgets } from "./api.ts";

export async function updateMarkdownPreview() {
  if (!(await clientStore.get("enableMarkdownPreview"))) {
    return;
  }
  const currentPage = await editor.getCurrentPage();
  const text = await editor.getText();
  const mdTree = await markdown.parseMarkdown(text);
  // const cleanMd = await cleanMarkdown(text);
  const css = await asset.readAsset("markdown", "assets/preview.css");
  const js = await asset.readAsset("markdown", "assets/preview.js");

  await expandCodeWidgets(mdTree, currentPage);
  const html = renderMarkdownToHtml(mdTree, {
    smartHardBreak: true,
    annotationPositions: true,
    translateUrls: (url) => {
      if (!url.includes("://")) {
        url = resolveAttachmentPath(currentPage, decodeURI(url));
      }
      return url;
    },
  });
  const customStyles = await editor.getUiOption("customStyles");
  const darkMode = await clientStore.get("darkMode");
  const theme = darkMode ? "dark" : "light";
  await editor.showPanel(
    "rhs",
    2,
    `<html>
      <head>
        <link rel="stylesheet" href="/.client/main.css" />
        <style>
          ${css}
          ${customStyles ?? ""}
        </style>
      </head>
      <body>
        <div id="root" class="sb-preview">${html}</div>
      </body>
    </html>`,
    `
      document.documentElement.dataset.theme = ${JSON.stringify(theme)};

      ${js}
    `,
  );
}

export async function previewClickHandler(e: any) {
  const [eventName, arg] = JSON.parse(e);
  // console.log("Got click", eventName, arg);
  switch (eventName) {
    case "pos":
      // console.log("Moving cursor to", +arg);
      await editor.moveCursor(+arg, true);
      break;
    case "command":
      await system.invokeCommand(arg);
      break;
  }
}
