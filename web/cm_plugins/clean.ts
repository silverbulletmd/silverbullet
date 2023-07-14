import type { ClickEvent } from "../../plug-api/app_event.ts";
import type { Extension } from "../deps.ts";
import type { Client } from "../client.ts";
import { blockquotePlugin } from "./block_quote.ts";
import { admonitionPlugin } from "./admonition.ts";
import { directivePlugin } from "./directive.ts";
import { hideHeaderMarkPlugin, hideMarksPlugin } from "./hide_mark.ts";
import { cleanBlockPlugin } from "./block.ts";
import { linkPlugin } from "./link.ts";
import { listBulletPlugin } from "./list.ts";
import { tablePlugin } from "./table.ts";
import { taskListPlugin } from "./task.ts";
import { cleanWikiLinkPlugin } from "./wiki_link.ts";
import { cleanCommandLinkPlugin } from "./command_link.ts";
import { fencedCodePlugin } from "./fenced_code.ts";

export function cleanModePlugins(editor: Client) {
  return [
    linkPlugin(),
    directivePlugin(),
    blockquotePlugin(),
    admonitionPlugin(editor),
    hideMarksPlugin(),
    hideHeaderMarkPlugin(),
    cleanBlockPlugin(),
    fencedCodePlugin(editor),
    taskListPlugin({
      // TODO: Move this logic elsewhere?
      onCheckboxClick: (pos) => {
        const clickEvent: ClickEvent = {
          page: editor.currentPage!,
          altKey: false,
          ctrlKey: false,
          metaKey: false,
          pos: pos,
        };
        // Propagate click event from checkbox
        editor.dispatchAppEvent("page:click", clickEvent);
      },
    }),
    listBulletPlugin(),
    tablePlugin(editor),
    cleanWikiLinkPlugin(editor),
    cleanCommandLinkPlugin(editor),
  ] as Extension[];
}
