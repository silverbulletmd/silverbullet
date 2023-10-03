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
       <div id="button-bar">
       <button id="reload-button" title="Reload"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg></button>
       <button id="edit-button" title="Edit"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-edit"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button>
       </div>
       ${html}
       </div></div></div>
  `;
}
