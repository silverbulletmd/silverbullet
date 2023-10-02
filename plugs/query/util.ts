import { asset } from "$sb/syscalls.ts";
import { panelHtml } from "../../web/components/panel_html.ts";

export async function prepareJS() {
  const iframeJS = await asset.readAsset("assets/common.js");

  return `
    const panelHtml = \`${panelHtml}\`;
    ${iframeJS}
    `;
}

export async function wrapHTML(html: string): Promise<string> {
  const css = await asset.readAsset("assets/style.css");

  return `
       <!-- Load SB's own CSS here too -->
       <link rel="stylesheet" href="/.client/main.css" />
       <!-- In addition to some custom CSS -->
       <style>${css}</style>
       <!-- Wrap the whole thing in something SB-like to get access to styles -->
       <div id="sb-main"><div id="sb-editor"><div class="cm-editor">
       <!-- And add an edit button -->
       <div id="button-bar"><button id="edit-button">✎</button></div>
       ${html}
       </div></div></div>
  `;
}
