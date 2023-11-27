import { asset } from "$sb/plugos-syscall/mod.ts";
import { clientStore, editor } from "$sb/silverbullet-syscall/mod.ts";
import { queryObjects } from "./api.ts";
import { LinkObject } from "./page_links.ts";

const hideMentionsKey = "hideMentions";

export async function toggleMentions() {
  let hideMentions = await clientStore.get(hideMentionsKey);
  hideMentions = !hideMentions;
  await clientStore.set(hideMentionsKey, hideMentions);
  if (!hideMentions) {
    await renderMentions();
  } else {
    await editor.hidePanel("bottom");
  }
}

// Triggered when switching pages or upon first load
export async function updateMentions() {
  if (await clientStore.get(hideMentionsKey)) {
    return;
  }
  await renderMentions();
}

// use internal navigation via syscall to prevent reloading the full page.
export async function navigate(ref: string) {
  const currentPage = await editor.getCurrentPage();
  const [page, pos] = ref.split(/[@$]/);
  if (page === currentPage) {
    await editor.moveCursor(+pos, true);
  } else {
    await editor.navigate(page, +pos);
  }
}

function escapeHtml(unsafe: string) {
  return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(
    />/g,
    "&gt;",
  );
}

export async function renderMentions() {
  const page = await editor.getCurrentPage();
  const linksResult = await queryObjects<LinkObject>("link", {
    // Query all links that point to this page, excluding those that are inside directives and self pointers.
    filter: ["and", ["!=", ["attr", "page"], ["string", page]], ["and", ["=", [
      "attr",
      "toPage",
    ], ["string", page]], ["=", ["attr", "inDirective"], ["boolean", false]]]],
  });
  if (linksResult.length === 0) {
    // Don't show the panel if there are no links here.
    await editor.hidePanel("bottom");
  } else {
    const css = await asset.readAsset("asset/style.css");
    const js = await asset.readAsset("asset/linked_mentions.js");

    await editor.showPanel(
      "bottom",
      1,
      ` <style>${css}</style>
        <div id="sb-main"><div id="sb-editor"><div class="cm-editor">
        <div id="button-bar">
        <button id="reload-button" title="Reload"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg></button>
        <button id="hide-button" title="Hide linked mentions"><svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" class="css-i6dzq1"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg></button>
        </div>
        <div class="cm-line sb-line-h2">Linked Mentions</div>
        <ul id="link-ul">
        ${
        linksResult.map((link) =>
          `<li data-ref="${link.ref}"><span class="sb-wiki-link-page">${link.ref}</span>: <code>...${
            escapeHtml(link.snippet)
          }...</code></li>`
        ).join("")
      }
        </ul>
        </div></div></div>
        `,
      js,
    );
  }
}
