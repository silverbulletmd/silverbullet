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
import { fencedCodePlugin } from "./fenced_code.ts";
import { frontmatterPlugin } from "./frontmatter.ts";
import { cleanEscapePlugin } from "./escapes.ts";
import { luaDirectivePlugin } from "./lua_directive.ts";
import { hashtagPlugin } from "./hashtag.ts";
import type { ClickEvent } from "@silverbulletmd/silverbullet/type/client";

export function cleanModePlugins(client: Client) {
  return [
    linkPlugin(client),
    blockquotePlugin(),
    admonitionPlugin(),
    hideMarksPlugin(),
    hideHeaderMarkPlugin(),
    cleanBlockPlugin(),
    frontmatterPlugin(),
    fencedCodePlugin(client),
    taskListPlugin({
      // TODO: Move this logic elsewhere?
      onCheckboxClick: (pos) => {
        const clickEvent: ClickEvent = {
          page: client.currentName(),
          altKey: false,
          ctrlKey: false,
          metaKey: false,
          pos: pos,
        };
        // Propagate click event from checkbox
        client.dispatchClickEvent(clickEvent);
      },
    }),
    listBulletPlugin(),
    tablePlugin(client),
    cleanWikiLinkPlugin(client),
    cleanEscapePlugin(),
    luaDirectivePlugin(client),
    hashtagPlugin(),
  ] as Extension[];
}
