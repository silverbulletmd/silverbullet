import type { ClickEvent } from "$sb/app_event.ts";
import { editor, markdown, system } from "$sb/silverbullet-syscall/mod.ts";
import { nodeAtPos, ParseTree } from "$sb/lib/tree.ts";

// Checks if the URL contains a protocol, if so keeps it, otherwise assumes an attachment
function patchUrl(url: string): string {
  if (url.indexOf("://") === -1) {
    return `fs/${url}`;
  }
  return url;
}

async function actionClickOrActionEnter(
  mdTree: ParseTree | null,
  inNewWindow = false,
) {
  if (!mdTree) {
    return;
  }
  // console.log("Attempting to navigate based on syntax node", mdTree);
  switch (mdTree.type) {
    case "WikiLinkPage": {
      let pageLink = mdTree.children![0].text!;
      let pos;
      if (pageLink.includes("@")) {
        [pageLink, pos] = pageLink.split("@");
        if (pos.match(/^\d+$/)) {
          pos = +pos;
        }
      }
      if (!pageLink) {
        pageLink = await editor.getCurrentPage();
      }
      await editor.navigate(pageLink, pos, false, inNewWindow);
      break;
    }
    case "URL":
    case "NakedURL":
      await editor.openUrl(patchUrl(mdTree.children![0].text!));
      break;
    case "Link": {
      const url = patchUrl(mdTree.children![4].children![0].text!);
      if (url.length <= 1) {
        return editor.flashNotification("Empty link, ignoring", "error");
      }
      await editor.openUrl(url);
      break;
    }
    case "CommandLink": {
      const command = mdTree.children![1].text!;
      console.log("Got command link", command);
      await system.invokeCommand(command);
      break;
    }
  }
}

export async function linkNavigate() {
  const mdTree = await markdown.parseMarkdown(await editor.getText());
  const newNode = nodeAtPos(mdTree, await editor.getCursor());
  await actionClickOrActionEnter(newNode);
}

export async function clickNavigate(event: ClickEvent) {
  // Navigate by default, don't navigate when Alt is held
  if (event.altKey) {
    return;
  }
  const mdTree = await markdown.parseMarkdown(await editor.getText());
  const newNode = nodeAtPos(mdTree, event.pos);
  await actionClickOrActionEnter(newNode, event.ctrlKey || event.metaKey);
}

export async function navigateCommand(cmdDef: any) {
  await editor.navigate(cmdDef.page);
}
