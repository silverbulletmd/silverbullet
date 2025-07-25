import { extractHashtag } from "../../plug-api/lib/tags.ts";
import { editor, markdown } from "@silverbulletmd/silverbullet/syscalls";
import {
  addParentPointers,
  findNodeOfType,
  findParentMatching,
  nodeAtPos,
  type ParseTree,
} from "@silverbulletmd/silverbullet/lib/tree";
import {
  isLocalPath,
  resolvePath,
} from "@silverbulletmd/silverbullet/lib/resolve";
import { parseRef } from "@silverbulletmd/silverbullet/lib/page_ref";
import { tagPrefix } from "../index/constants.ts";
import type { ClickEvent } from "@silverbulletmd/silverbullet/type/client";

async function actionClickOrActionEnter(
  mdTree: ParseTree | null,
  inNewWindow = false,
) {
  if (!mdTree) {
    return;
  }
  const navigationNodeFinder = (t: ParseTree) =>
    [
      "WikiLink",
      "Link",
      "Image",
      "URL",
      "NakedURL",
      "Link",
      "PageRef",
      "Hashtag",
    ]
      .includes(
        t.type!,
      );
  if (!navigationNodeFinder(mdTree)) {
    mdTree = findParentMatching(mdTree, navigationNodeFinder);
    if (!mdTree) {
      return;
    }
  }
  const currentPage = await editor.getCurrentPage();
  switch (mdTree.type) {
    case "WikiLink": {
      const link = mdTree.children![1]!.children![0].text!;
      const currentPath = await editor.getCurrentPath();
      const ref = parseRef(link);
      ref.page = resolvePath(currentPage, "/" + ref.page);
      if (!ref.page) {
        ref.page = currentPath;
      }
      // This is an explicit navigate, move to the top
      if (ref.kind === "page" && ref.pos === undefined) {
        ref.pos = 0;
      }
      return editor.navigate(ref, false, inNewWindow);
    }
    case "PageRef": {
      const pageName = parseRef(mdTree.children![0].text!).page;
      return editor.navigate(
        { kind: "page", page: pageName, pos: 0 },
        false,
        inNewWindow,
      );
    }
    case "NakedURL":
    case "URL":
      return editor.openUrl(mdTree.children![0].text!);
    case "Image":
    case "Link": {
      const urlNode = findNodeOfType(mdTree, "URL");
      if (!urlNode) {
        return;
      }
      const url = urlNode.children![0].text!;
      if (url.length <= 1) {
        return editor.flashNotification("Empty link, ignoring", "error");
      }
      if (isLocalPath(url)) {
        if (/\.[a-zA-Z0-9>]+$/.test(url)) {
          return editor.openUrl(
            resolvePath(currentPage, decodeURI(url)),
          );
        } else {
          return editor.navigate(
            parseRef(resolvePath(currentPage, decodeURI(url))),
            false,
            inNewWindow,
          );
        }
      } else {
        return editor.openUrl(url);
      }
    }
    case "Hashtag": {
      const hashtag = extractHashtag(mdTree.children![0].text!);
      await editor.navigate(
        { kind: "page", page: `${tagPrefix}${hashtag}`, pos: 0 },
        false,
        inNewWindow,
      );
      break;
    }
  }
}

export async function linkNavigate() {
  const mdTree = await markdown.parseMarkdown(await editor.getText());
  const newNode = nodeAtPos(mdTree, await editor.getCursor());
  addParentPointers(mdTree);
  await actionClickOrActionEnter(newNode);
}

export async function clickNavigate(event: ClickEvent) {
  // Navigate by default, don't navigate when Alt is held
  if (event.altKey) {
    return;
  }
  const mdTree = await markdown.parseMarkdown(await editor.getText());
  addParentPointers(mdTree);
  const newNode = nodeAtPos(mdTree, event.pos);
  await actionClickOrActionEnter(newNode, event.ctrlKey || event.metaKey);
}

export async function navigateCommand(cmdDef: any) {
  await editor.navigate({ kind: "page", page: cmdDef.page, pos: 0 });
}

export async function navigateToPage(_cmdDef: any, pageName: string) {
  await editor.navigate({ kind: "page", page: pageName, pos: 0 });
}

export async function navigateToURL(_cmdDef: any, url: string) {
  await editor.openUrl(url, false);
}

export async function navigateBack() {
  await editor.goHistory(-1);
}

export async function navigateForward() {
  await editor.goHistory(1);
}
