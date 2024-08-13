import {
  findNodeOfType,
  type ParseTree,
  renderToText,
  replaceNodesMatchingAsync,
} from "../../plug-api/lib/tree.ts";
import { codeWidget } from "@silverbulletmd/silverbullet/syscalls";
import { parseMarkdown } from "../../plug-api/syscalls/markdown.ts";
import {
  type MarkdownRenderOptions,
  renderMarkdownToHtml,
} from "./markdown_render.ts";
import { validatePageName } from "@silverbulletmd/silverbullet/lib/page_ref";
import { parsePageRef } from "@silverbulletmd/silverbullet/lib/page_ref";

/**
 * Finds code widgets, runs their plug code to render and inlines their content in the parse tree
 * @param mdTree parsed markdown tree
 * @param pageName name of the current page
 * @returns modified mdTree
 */
export async function expandCodeWidgets(
  mdTree: ParseTree,
  pageName: string,
): Promise<ParseTree> {
  await replaceNodesMatchingAsync(mdTree, async (n) => {
    if (n.type === "FencedCode") {
      const codeInfo = findNodeOfType(n, "CodeInfo");
      if (!codeInfo) {
        return;
      }
      const codeType = codeInfo.children![0].text!;
      const codeTextNode = findNodeOfType(n, "CodeText");
      try {
        // This will error out if this is not a code wiget, which is fine
        const result = await codeWidget.render(
          codeType,
          renderToText(codeTextNode!),
          pageName,
        );
        if (!result) {
          return {
            text: "",
          };
        }
        // Only do this for "markdown" widgets, that is: that can render to markdown
        if (result.markdown !== undefined) {
          const parsedBody = await parseMarkdown(result.markdown);
          // Recursively process
          return expandCodeWidgets(
            parsedBody,
            pageName,
          );
        }
      } catch (e: any) {
        // 'not found' is to be expected (no code widget configured for this language)
        // Every other error should probably be reported
        if (!e.message.includes("not found")) {
          console.trace();
          console.error("Error rendering code", e.message);
        }
      }
    } else if (n.type === "Image") {
      // Let's scan for ![[embeds]] that are codified as Images, confusingly
      const wikiLinkMark = findNodeOfType(n, "WikiLinkMark");
      if (!wikiLinkMark) {
        return;
      }
      const wikiLinkPage = findNodeOfType(n, "WikiLinkPage");
      if (!wikiLinkPage) {
        return;
      }

      const page = wikiLinkPage.children![0].text!;

      // Check if this is likely a page link (based on the path format, e.g. if it contains an extension, it's probably not a page link)
      try {
        const ref = parsePageRef(page);
        validatePageName(ref.page);
      } catch {
        // Not a valid page name, so not a page reference
        return;
      }

      // Internally translate this to a template that inlines a page, then render that
      const result = await codeWidget.render(
        "template",
        `{{[[${page}]]}}`,
        page,
      );
      if (!result) {
        return {
          text: "",
        };
      }
      // Only do this for "markdown" widgets, that is: that can render to markdown
      if (result.markdown !== undefined) {
        const parsedBody = await parseMarkdown(result.markdown);
        // Recursively process
        return expandCodeWidgets(
          parsedBody,
          page,
        );
      }
    }
  });
  return mdTree;
}

export async function markdownToHtml(
  markdown: string,
  options: MarkdownRenderOptions = {},
) {
  const mdTree = await parseMarkdown(markdown);
  return renderMarkdownToHtml(mdTree, options);
}
