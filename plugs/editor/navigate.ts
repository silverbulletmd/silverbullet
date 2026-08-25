import {
  getNameFromPath,
  type Path,
  parseToRef,
} from "@silverbulletmd/silverbullet/lib/ref";
import {
  lookupIndex,
  resolvePath,
} from "@silverbulletmd/silverbullet/lib/resolve_path";
import {
  folderName,
  isLocalURL,
  resolveMarkdownLink,
} from "@silverbulletmd/silverbullet/lib/resolve";
import { extractHashtag } from "@silverbulletmd/silverbullet/lib/tags";
import {
  addParentPointers,
  collectNodesOfType,
  findNodeOfType,
  findParentMatching,
  nodeAtPos,
  type ParseTree,
  renderToText,
} from "@silverbulletmd/silverbullet/lib/tree";
import {
  config,
  editor,
  markdown,
  space,
} from "@silverbulletmd/silverbullet/syscalls";
import type { ClickEvent } from "@silverbulletmd/silverbullet/type/client";
import { tagPrefix } from "../index/constants.ts";
import { recipientId } from "../index/recipient.ts";

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
      "Autolink",
      "NakedURL",
      "Hashtag",
      "AtMention",
      "FootnoteRef",
    ].includes(t.type!);
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

      if (ref.path === "" && ref.details?.type !== "anchor") {
        ref.path = currentPath;
      } else if (ref.path !== "") {
        // A bare link names a page, not a path: resolve it the same way the
        // renderer does, or following it would create an empty page at the
        // root instead of opening the one the link points at. An unresolved
        // path is left alone so "click to create" still works.
        const resolution = resolvePath(
          ref.path,
          currentPath as Path,
          lookupIndex(await space.lookupPaths([ref.path])),
        );
        if (resolution.ambiguous && resolution.candidates) {
          // Following an ambiguous link means saying which page was meant.
          // The link text itself is left alone: following a link is reading,
          // and reading should not edit the document. Every navigation route
          // lands here — click, Navigate: To This Page, Cmd-Enter — so they
          // all get the same picker.
          const selected = await editor.filterBox(
            "Which page?",
            resolution.candidates.map((path) => ({
              name: getNameFromPath(path),
              description: folderName(path) || "space root",
              path,
            })),
            `“${link}” matches ${resolution.candidates.length} pages. Pick the one to open.`,
          );
          if (!selected) {
            return;
          }
          ref.path = (selected as unknown as { path: Path }).path;
        } else if (resolution.exists) {
          ref.path = resolution.path;
        }
      }

      return editor.navigate(ref, false, inNewWindow);
    }
    // https://example.org
    case "NakedURL":
      return editor.openUrl(mdTree.children![0].text!);
    // <https://example.org>
    case "Autolink": {
      const urlNode = findNodeOfType(mdTree, "URL");
      if (!urlNode) {
        return;
      }

      return editor.openUrl(urlNode.children![0].text!);
    }
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
      if (isLocalURL(url)) {
        const link = resolveMarkdownLink(currentPage, decodeURI(url));
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
      const tagPage = await config.get(["tags", hashtag, "tagPage"], null);
      await editor.navigate(
        tagPage ?? `${tagPrefix}${hashtag}`,
        false,
        inNewWindow,
      );
      break;
    }
    case "AtMention": {
      // A recipient is a name, not a place: the mention has nowhere to
      // navigate to, so it opens the Mention Inbox filtered on that
      // recipient without pulling focus out of the editor.
      const nickname = renderToText(mdTree).slice(1);
      await editor.openNavigator("inbox", {
        dropdown: recipientId(nickname),
        focus: false,
      });
      break;
    }
    case "FootnoteRef": {
      const label = findNodeOfType(mdTree, "FootnoteRefLabel")!.children![0]
        .text!;
      // Walk up to root and find the matching definition in the parse tree
      let root: ParseTree = mdTree;
      while (root.parent) {
        root = root.parent;
      }
      const defs = collectNodesOfType(root, "FootnoteDefinition");
      const def = defs.find((d) => {
        const defLabel = findNodeOfType(d, "FootnoteDefLabel");
        return defLabel?.children?.[0]?.text === label;
      });
      if (def) {
        await editor.moveCursor(def.from!);
      } else {
        await editor.flashNotification(
          `Footnote [^${label}] is not defined`,
          "error",
        );
      }
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

export async function createPageUnderCursorCommand() {
  const mdTree = await markdown.parseMarkdown(await editor.getText());
  addParentPointers(mdTree);
  let newNode = nodeAtPos(mdTree, await editor.getCursor());
  if (!newNode) {
    await editor.flashNotification("No page link under cursor", "error");
    return;
  }
  newNode = findParentMatching(newNode, (n) => n.type === "WikiLink");
  if (!newNode) {
    await editor.flashNotification("No page link under cursor", "error");
    return;
  }
  const wikiLinkPage = findNodeOfType(newNode, "WikiLinkPage")!;
  const pageName = wikiLinkPage.children![0].text!;
  if (pageName) {
    if (await space.pageExists(pageName)) {
      await editor.flashNotification(
        "Page under cursor already exists",
        "error",
      );
    } else {
      await space.writePage(pageName, "");
      await editor.dispatch({});
      await editor.flashNotification(`Empty page ${pageName} created.`);
    }
  }
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
