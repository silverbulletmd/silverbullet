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
import { parseToRef } from "@silverbulletmd/silverbullet/lib/ref";
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
      const ref = parseToRef(link);

      if (!ref) {
        return editor.flashNotification(
          `Couldn't navigate to ${link}, WikiLink is invalid`,
          "error",
        );
      }

      if (ref.path === "") {
        ref.path = currentPath;
      }

      // TODO: Navigate behind frontmatter?
      // This is an explicit navigate, move to the top
      if (!ref.details) {
        ref.details = {
          type: "position",
          pos: 0,
        };
      }
      return editor.navigate(ref, false, inNewWindow);
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
        const link = resolvePath(currentPage, decodeURI(url));
        // Parse the ref explicitly to throw a nice error message
        const ref = parseToRef(link);

        if (!ref) {
          return editor.flashNotification(
            `Couldn't navigate to ${link}, Link is invalid`,
            "error",
          );
        }

        return editor.navigate(ref);
      } else {
        return editor.openUrl(url);
      }
    }
    case "Hashtag": {
      const hashtag = extractHashtag(mdTree.children![0].text!);
      await editor.navigate(
        `${tagPrefix}${hashtag}`,
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
  await navigateToPage(cmdDef, cmdDef.page);
}

export async function navigateToPage(_cmdDef: any, pageName: string) {
  const ref = parseToRef(pageName);
  if (!ref) {
    await editor.flashNotification(
      `Couldn't navigate to ${pageName}, page name is invalid`,
      "error",
    );
    return;
  }

  if (!ref?.details) {
    ref.details = {
      type: "position",
      pos: 0,
    };
  }

  await editor.navigate(ref);
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
