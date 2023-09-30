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
    const name = await editor.getCurrentPage();
    await renderMentions(name);
  } else {
    await editor.hidePanel("ps");
  }
}

// Triggered when switching pages or upon first load
export async function updateMentions() {
  if (await clientStore.get(hideMentionsKey)) {
    return;
  }
  const name = await editor.getCurrentPage();
  await renderMentions(name);
}

// use internal navigation via syscall to prevent reloading the full page.
export async function navigate(ref: string) {
  const [page, pos] = ref.split("@");
  await editor.navigate(page, +pos);
}

function escapeHtml(unsafe: string) {
  return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(
    />/g,
    "&gt;",
  );
}

async function renderMentions(page: string) {
  const linksResult = await queryObjects<LinkObject>("link", {
    // Query all links that point to this page, excluding those that are inside directives and self pointers.
    filter: ["and", ["!=", ["attr", "page"], ["string", page]], ["and", ["=", [
      "attr",
      "toPage",
    ], ["string", page]], ["=", ["attr", "inDirective"], ["boolean", false]]]],
  });
  if (linksResult.length === 0) {
    // Don't show the panel if there are no links here.
    await editor.hidePanel("ps");
  } else {
    const css = await asset.readAsset("asset/style.css");
    const js = await asset.readAsset("asset/script.js");

    await editor.showPanel(
      "ps",
      1,
      ` <style>${css}</style>
        <link rel="stylesheet" href="/.client/main.css" />
        <div id="sb-main"><div id="sb-editor"><div class="cm-editor">
        <button id="hide-button">Hide</button>
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
