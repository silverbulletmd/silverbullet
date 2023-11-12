import { WidgetContent } from "$sb/app_event.ts";
import { asset, markdown } from "$sb/syscalls.ts";
import { panelHtml } from "../../web/components/panel_html.ts";
import { renderMarkdownToHtml } from "./markdown_render.ts";

export async function markdownContentWidget(
  markdownText: string,
  pageName: string,
): Promise<WidgetContent> {
  // Parse markdown to a ParseTree
  const mdTree = await markdown.parseMarkdown(markdownText);
  // And then render it to HTML
  const html = renderMarkdownToHtml(mdTree, { smartHardBreak: true });
  return {
    html: await wrapHTML(html),
    script: await prepareJS(pageName, markdownText),
    // And add back the markdown text so we can render it in a different way if desired
    markdown: markdownText,
  };
}

export async function prepareJS(pageName: string, originalMarkdown: string) {
  const iframeJS = await asset.readAsset("assets/markdown_widget.js");
  return `
    const panelHtml = ${JSON.stringify(panelHtml)};
    const pageName = ${JSON.stringify(pageName)};
    const originalMarkdown = ${JSON.stringify(originalMarkdown)};
    ${iframeJS}
    `;
}

export async function wrapHTML(html: string): Promise<string> {
  const css = await asset.readAsset("assets/markdown_widget.css");

  return `
       <!-- In addition to some custom CSS -->
       <style>${css}</style>
       <!-- Wrap the whole thing in something SB-like to get access to styles -->
       <div id="sb-main"><div id="sb-editor"><div class="cm-editor">
       <!-- And add an edit button -->
       <div id="button-bar">
       <button id="source-button" title="Show Markdown source"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-code"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg></button>
       <button id="reload-button" title="Reload"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg></button>
       <button id="edit-button" title="Edit"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-edit"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button>
       </div>
       <div id="body-content">
       ${html}
       </div>
       </div></div></div>
  `;
}
