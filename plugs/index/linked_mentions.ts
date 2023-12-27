import { clientStore, editor, system } from "$sb/silverbullet-syscall/mod.ts";
import { CodeWidgetContent } from "$sb/types.ts";
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
    await editor.dispatch({});
  }
}

export async function renderMentions(): Promise<CodeWidgetContent | null> {
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
    };
  }
}
