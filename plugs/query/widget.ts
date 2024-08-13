import {
  codeWidget,
  editor,
  markdown,
  system,
} from "@silverbulletmd/silverbullet/syscalls";
import {
  addParentPointers,
  collectNodesOfType,
  findNodeOfType,
  findParentMatching,
  type ParseTree,
  removeParentPointers,
  renderToText,
} from "@silverbulletmd/silverbullet/lib/tree";
import { parseQuery } from "../../plug-api/lib/parse_query.ts";
import { loadPageObject, replaceTemplateVars } from "../template/page.ts";
import type { CodeWidgetContent } from "../../plug-api/types.ts";
import { jsonToMDTable } from "../template/util.ts";
import { renderQuery } from "./api.ts";
import type { ChangeSpec } from "@codemirror/state";
import {
  findNodeMatching,
  nodeAtPos,
} from "@silverbulletmd/silverbullet/lib/tree";

export async function widget(
  bodyText: string,
  pageName: string,
): Promise<CodeWidgetContent> {
  const config = await system.getSpaceConfig();
  const pageObject = await loadPageObject(pageName);
  try {
    let resultMarkdown = "";
    const parsedQuery = await parseQuery(
      await replaceTemplateVars(bodyText, pageObject, config),
    );

    const results = await renderQuery(parsedQuery, {
      page: pageObject,
      config,
    });
    if (Array.isArray(results)) {
      resultMarkdown = jsonToMDTable(results);
    } else {
      resultMarkdown = results;
    }

    return {
      markdown: resultMarkdown,
      buttons: [
        {
          description: "Bake result",
          svg:
            `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-align-left"><line x1="17" y1="10" x2="3" y2="10"></line><line x1="21" y1="6" x2="3" y2="6"></line><line x1="21" y1="14" x2="3" y2="14"></line><line x1="17" y1="18" x2="3" y2="18"></line></svg>`,
          invokeFunction: ["query.bakeButton", bodyText],
        },
        {
          description: "Edit",
          svg:
            `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-edit"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`,
          invokeFunction: ["query.editButton", bodyText],
        },
        {
          description: "Reload",
          svg:
            `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-refresh-cw"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>`,
          invokeFunction: ["query.refreshAllWidgets"],
        },
      ],
    };
  } catch (e: any) {
    return { markdown: `**Error:** ${e.message}` };
  }
}

export function refreshAllWidgets() {
  codeWidget.refreshAll();
}

export async function editButton(bodyText: string) {
  const text = await editor.getText();
  // This is a bit of a heuristic and will point to the wrong place if the same body text appears in multiple places, which is easy to replicate but unlikely to happen in the real world
  // A more accurate fix would be to update the widget (and therefore the index of where this widget appears) on every change, but this would be rather expensive. I think this is good enough.
  const bodyPos = text.indexOf("\n" + bodyText + "\n");
  if (bodyPos === -1) {
    await editor.flashNotification("Could not find widget to edit", "error");
    return;
  }
  await editor.moveCursor(bodyPos + 1);
}

export async function bakeButton(bodyText: string) {
  try {
    const text = await editor.getText();
    const tree = await markdown.parseMarkdown(text);
    addParentPointers(tree);

    // Need to find it in page to make the replacement, see editButton for comment about finding by content
    const textNode = findNodeMatching(tree, (n) => n.text === bodyText) ||
      nodeAtPos(tree, text.indexOf(bodyText));
    if (!textNode) {
      throw new Error(`Could not find node to bake`);
    }
    const blockNode = findParentMatching(
      textNode,
      (n) => n.type === "FencedCode" || n.type === "Image",
    );
    if (!blockNode) {
      removeParentPointers(textNode);
      console.error("baked node", textNode);
      throw new Error("Could not find FencedCode above baked node");
    }
    const changes = await changeForBake(blockNode);

    if (changes) {
      await editor.dispatch({ changes });
    } else {
      // Either something failed, or this widget does not meet requirements for baking and shouldn't show the button at all
      throw new Error("Baking with button didn't produce any changes");
    }
  } catch (error) {
    console.error(error);
    await editor.flashNotification("Could not bake widget", "error");
  }
}

export async function bakeAllWidgets() {
  const text = await editor.getText();
  const tree = await markdown.parseMarkdown(text);

  const changes = (await Promise.all(
    collectNodesOfType(tree, "FencedCode").map(changeForBake),
  )).filter((c): c is ChangeSpec => c !== null);

  await editor.dispatch({ changes });
  await editor.flashNotification(`Baked ${changes.length} live blocks`);
}

/**
 * Create change description to replace a widget source with its markdown output
 * @param nodeToReplace node of type FencedCode or Image for a markdown widget (eg. query, template, toc)
 * @returns single replacement for the editor, or null if the widget didn't render to markdown
 */
async function changeForBake(
  nodeToReplace: ParseTree,
): Promise<ChangeSpec | null> {
  const lang = nodeToReplace.type === "FencedCode"
    ? renderToText(findNodeOfType(nodeToReplace, "CodeInfo") ?? undefined)
    : nodeToReplace.type === "Image"
    ? "transclusion"
    : undefined;

  let body: string | undefined = undefined;
  if (nodeToReplace.type === "FencedCode") {
    body = renderToText(findNodeOfType(nodeToReplace, "CodeText") ?? undefined);
  } else if (nodeToReplace.type === "Image") {
    body = renderToText(nodeToReplace);
  }

  if (!lang || body === undefined) {
    return null;
  }

  const content = await codeWidget.render(
    lang,
    body,
    await editor.getCurrentPage(),
  );
  if (
    !content || !content.markdown === undefined ||
    nodeToReplace.from === undefined ||
    nodeToReplace.to === undefined
  ) { // Check attributes for undefined because 0 or empty string could be valid
    return null;
  }

  return {
    from: nodeToReplace.from,
    to: nodeToReplace.to,
    insert: content.markdown,
  };
}
