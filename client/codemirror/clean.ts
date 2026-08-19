import type { Extension } from "@codemirror/state";
import type { ClickEvent } from "@silverbulletmd/silverbullet/type/client";
import type { Client } from "../client.ts";
import { admonitionPlugin } from "./admonition.ts";
import { atMentionPlugin } from "./at_mention.ts";
import { attributePlugin } from "./attribute.ts";
import { cleanBlockPlugin } from "./block.ts";
import { blockquotePlugin } from "./block_quote.ts";
import { commentRegionPlugin } from "./comment_region.ts";
import { customSyntaxPlugin } from "./custom_syntax_widget.ts";
import { cleanEscapePlugin } from "./escapes.ts";
import { fencedCodePlugin } from "./fenced_code.ts";
import { footnotePlugin } from "./footnote.ts";
import { frontmatterPlugin } from "./frontmatter.ts";
import { hashtagPlugin } from "./hashtag.ts";
import { hideHeaderMarkPlugin, hideMarksPlugin } from "./hide_mark.ts";
import { htmlBlockPlugin, htmlInlinePlugin } from "./html_widget.ts";
import { linkPlugin } from "./link.ts";
import { listBulletPlugin } from "./list.ts";
import { listIndentPlugin } from "./list_indent.ts";
import { luaDirectivePlugin } from "./lua_directive.ts";
import { tablePlugin } from "./table.ts";
import { taskListPlugin } from "./task.ts";
import { cleanWikiLinkPlugin } from "./wiki_link.ts";

export function cleanModePlugins(client: Client) {
  const pluginsNeededEvenWhenRenderingSyntax = [
    luaDirectivePlugin(client),
    cleanWikiLinkPlugin(client),
    hashtagPlugin(client),
    atMentionPlugin(),
    attributePlugin(),
    frontmatterPlugin(client),
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
        // Propagate click event from checkbox
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
