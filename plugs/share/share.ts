import { editor, events, markdown, system } from "$sb/syscalls.ts";
import { findNodeOfType, renderToText } from "../../plug-api/lib/tree.ts";
import { replaceNodesMatching } from "../../plug-api/lib/tree.ts";
import { ParseTree } from "../../plug-api/lib/tree.ts";
import { parsePageRef } from "$sb/lib/page_ref.ts";

type ShareOption = {
  id: string;
  name: string;
};

export async function shareCommand() {
  await editor.save();
  const pageName = await editor.getCurrentPage();

  const optionResponses: ShareOption[] =
    (await events.dispatchEvent("share:options", pageName)).flat();
  console.log("All options", optionResponses);
  const selectedShareOption: any = await editor.filterBox(
    "Share",
    optionResponses,
    "Pick a share option",
  );
  if (!selectedShareOption) {
    return;
  }
  console.log("Picked", selectedShareOption);

  let text = await editor.getText();
  const selection = await editor.getSelection();
  if (selection.from !== selection.to) {
    text = text.substring(selection.from, selection.to);
  }

  await events.dispatchEvent(
    `share:${selectedShareOption.id}`,
    text,
  );
}

export function clipboardShareOptions() {
  return [
    {
      id: "clean-markdown",
      name: "Copy to clipboard as clean markdown",
    },
    {
      id: "rich-text",
      name: "Copy to clipboard as rich text",
    },
  ];
}

export async function clipboardMarkdownShare(text: string) {
  const pageName = await editor.getCurrentPage();
  const tree = await markdown.parseMarkdown(text);
  let rendered = await system.invokeFunction(
    "markdown.expandCodeWidgets",
    tree,
    pageName,
  );
  rendered = cleanMarkdown(rendered);
  await editor.copyToClipboard(renderToText(rendered).trim());
  await editor.flashNotification("Copied to clipboard!");
}

export function cleanMarkdown(tree: ParseTree): ParseTree {
  replaceNodesMatching(tree, (node) => {
    switch (node.type) {
      case "FrontMatter":
        return null;
      case "WikiLink": {
        const ref = findNodeOfType(node, "WikiLinkPage")!.children![0].text!;
        let linkText = ref.split("/").pop()!;
        const aliasNode = findNodeOfType(node, "WikiLinkAlias");
        if (aliasNode) {
          linkText = aliasNode.children![0].text!;
        }
        const pageRef = parsePageRef(ref);
        return {
          text: `[${linkText}](${
            typeof location !== "undefined" ? location.origin : ""
          }/${encodeURI(pageRef.page)})`,
        };
      }
      case "NamedAnchor":
        // Just remove these
        return null;
      case "CommandLink": {
        // Child 0 is CommandLinkMark, child 1 is CommandLinkPage
        const command = node.children![1].children![0].text!;
        let commandText = command;
        const aliasNode = findNodeOfType(node, "CommandLinkAlias");

        if (aliasNode) {
          commandText = aliasNode.children![0].text!;
        }

        return {
          text: "`" + commandText + "`",
        };
      }

      case "Attribute":
        // Just remove these
        return null;
    }
  });
  return tree;
}

export async function clipboardRichTextShare(text: string) {
  const pageName = await editor.getCurrentPage();
  const tree = await markdown.parseMarkdown(text);
  let rendered = await system.invokeFunction(
    "markdown.expandCodeWidgets",
    tree,
    pageName,
  );
  rendered = cleanMarkdown(rendered);
  const html = await system.invokeFunction(
    "markdown.markdownToHtml",
    renderToText(rendered),
  );
  console.log("HTML", html);
  await editor.copyToClipboard(new Blob([html], { type: "text/html" }));
  await editor.flashNotification("Copied to rich text to clipboard!");
}
