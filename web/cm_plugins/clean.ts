import type { ClickEvent } from "../../plug-api/app_event.ts";
import type { Extension } from "../deps.ts";
import { Editor } from "../editor.tsx";
import { blockquotePlugin } from "./block_quote.ts";
import { directivePlugin } from "./directive.ts";
import { hideHeaderMarkPlugin, hideMarks } from "./hide_mark.ts";
import { hideImageNodePlugin } from "./image.ts";
import { goToLinkPlugin } from "./link.ts";
import { listBulletPlugin } from "./list.ts";
import { tablePlugin } from "./table.ts";
import { taskListPlugin } from "./task.ts";
import { cleanWikiLinkPlugin } from "./wiki_link.ts";

export function cleanModePlugins(editor: Editor) {
  return [
    goToLinkPlugin,
    directivePlugin,
    blockquotePlugin,
    hideMarks(),
    hideHeaderMarkPlugin,
    hideImageNodePlugin,
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
    listBulletPlugin,
    tablePlugin,
    cleanWikiLinkPlugin(),
  ] as Extension[];
}
