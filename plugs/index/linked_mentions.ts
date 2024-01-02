import { clientStore, codeWidget, editor, system } from "$sb/syscalls.ts";
import { CodeWidgetContent } from "$sb/types.ts";
import { queryObjects } from "./api.ts";
import { LinkObject } from "./page_links.ts";

const hideMentionsKey = "hideMentions";

export async function toggleMentions() {
  let hideMentions = await clientStore.get(hideMentionsKey);
  hideMentions = !hideMentions;
  await clientStore.set(hideMentionsKey, hideMentions);
  await codeWidget.refreshAll();
}

export async function renderMentions(): Promise<CodeWidgetContent | null> {
  if (await clientStore.get(hideMentionsKey)) {
    return null;
  }

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
    return null;
  } else {
    let renderedMd = "# Linked Mentions\n";
    for (const link of linksResult) {
      let snippet = await system.invokeFunction(
        "markdown.markdownToHtml",
        link.snippet,
      );
      // strip HTML tags
      snippet = snippet.replace(/<[^>]*>?/gm, "");
      renderedMd += `* [[${link.ref}]]: ...${snippet}...\n`;
    }
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
          invokeFunction: "index.toggleMentions",
        },
      ],
    };
  }
}
