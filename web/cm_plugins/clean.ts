import type { ClickEvent } from "../../plug-api/types.ts";
import type { Extension } from "@codemirror/state";
import type { Client } from "../client.ts";
import { blockquotePlugin } from "./block_quote.ts";
import { admonitionPlugin } from "./admonition.ts";
import { hideHeaderMarkPlugin, hideMarksPlugin } from "./hide_mark.ts";
import { cleanBlockPlugin } from "./block.ts";
import { linkPlugin } from "./link.ts";
import { listBulletPlugin } from "./list.ts";
import { tablePlugin } from "./table.ts";
import { taskListPlugin } from "./task.ts";
import { cleanWikiLinkPlugin } from "./wiki_link.ts";
import { cleanCommandLinkPlugin } from "./command_link.ts";
import { fencedCodePlugin } from "./fenced_code.ts";
import { frontmatterPlugin } from "./frontmatter.ts";

export function cleanModePlugins(client: Client) {
  return [
    linkPlugin(client),
    blockquotePlugin(),
    admonitionPlugin(client),
    hideMarksPlugin(),
    hideHeaderMarkPlugin(),
    cleanBlockPlugin(),
    frontmatterPlugin(),
    fencedCodePlugin(client),
    taskListPlugin({
      // TODO: Move this logic elsewhere?
      onCheckboxClick: (pos) => {
        const clickEvent: ClickEvent = {
          page: client.currentPage,
          altKey: false,
          ctrlKey: false,
          metaKey: false,
          pos: pos,
        };
        // Propagate click event from checkbox
        client.dispatchAppEvent("page:click", clickEvent);
      },
    }),
    listBulletPlugin(),
    tablePlugin(client),
    cleanWikiLinkPlugin(client),
    cleanCommandLinkPlugin(client),
  ] as Extension[];
}
