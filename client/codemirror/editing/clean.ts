import type { Extension } from "@codemirror/state";
import type { ClickEvent } from "@silverbulletmd/silverbullet/type/client";
import type { Client } from "../../client.ts";
import { admonitionPlugin } from "../syntax/admonition.ts";
import { atMentionPlugin } from "../syntax/at_mention.ts";
import { attributePlugin } from "../syntax/attribute.ts";
import { cleanBlockPlugin } from "../syntax/block.ts";
import { blockquotePlugin } from "../syntax/block_quote.ts";
import { commentRegionPlugin } from "../syntax/comment_region.ts";
import { cleanEscapePlugin } from "../syntax/escapes.ts";
import { fencedCodePlugin } from "../syntax/fenced_code.ts";
import { footnotePlugin } from "../syntax/footnote.ts";
import { frontmatterPlugin } from "../syntax/frontmatter.ts";
import { frontmatterPreviewPlugin } from "../syntax/frontmatter_preview.ts";
import { hashtagPlugin } from "../syntax/hashtag.ts";
import { hideHeaderMarkPlugin, hideMarksPlugin } from "../syntax/hide_mark.ts";
import { linkPlugin } from "../syntax/link.ts";
import { listBulletPlugin } from "../syntax/list.ts";
import { tablePlugin } from "../syntax/table.ts";
import { taskListPlugin } from "../syntax/task.ts";
import { cleanWikiLinkPlugin } from "../syntax/wiki_link.ts";
import { customSyntaxPlugin } from "../widgets/custom_syntax_widget.ts";
import { htmlBlockPlugin, htmlInlinePlugin } from "../widgets/html_widget.ts";
import { luaDirectivePlugin } from "../widgets/lua_directive.ts";
import { listIndentPlugin } from "./list_indent.ts";

export function cleanModePlugins(client: Client) {
  const pluginsNeededEvenWhenRenderingSyntax = [
    luaDirectivePlugin(client),
    cleanWikiLinkPlugin(client),
    hashtagPlugin(client),
    atMentionPlugin(),
    attributePlugin(client),
    frontmatterPlugin(client),
    frontmatterPreviewPlugin(client),
    customSyntaxPlugin(client),
  ];

  if (client.ui.viewState.uiOptions.markdownSyntaxRendering) {
    return pluginsNeededEvenWhenRenderingSyntax;
  }

  return [
    ...pluginsNeededEvenWhenRenderingSyntax,
    linkPlugin(client),
    blockquotePlugin(),
    admonitionPlugin(),
    commentRegionPlugin(client),
    hideMarksPlugin(),
    hideHeaderMarkPlugin(),
    cleanBlockPlugin(),
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
        void client.dispatchClickEvent(clickEvent);
      },
      getView: () => client.editorView,
      doneStates: (() => {
        const taskStates = client.config.get("taskStates", {});
        const done = new Set<string>();
        for (const [name, spec] of Object.entries(taskStates) as [
          string,
          any,
        ][]) {
          if (spec.done) done.add(name);
        }
        return done;
      })(),
    }),
    listBulletPlugin(),
    listIndentPlugin(),
    htmlInlinePlugin(client),
    htmlBlockPlugin(client),
    tablePlugin(client),
    cleanEscapePlugin(),
    ...footnotePlugin(() => client.editorView),
  ] as Extension[];
}
