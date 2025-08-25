import type { EditorState, Range } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { Decoration } from "@codemirror/view";
import {
  decoratorStateField,
  invisibleDecoration,
  isCursorInRange,
  shouldRenderWidgets,
} from "./util.ts";
import type { Client } from "../client.ts";
import {
  isLocalURL,
  resolveMarkdownLink,
} from "@silverbulletmd/silverbullet/lib/resolve";
import { LuaWidget } from "./lua_widget.ts";
import { mdLinkRegex, wikiLinkRegex } from "../markdown_parser/constants.ts";
import {
  type ContentDimensions,
  inlineHtmlFromURL,
  parseDimensionFromAlias,
} from "../markdown/inline.ts";

export function inlineContentPlugin(client: Client) {
  return decoratorStateField((state: EditorState) => {
    const widgets: Range<Decoration>[] = [];
    if (!shouldRenderWidgets(client)) {
      console.info("Not rendering widgets");
      return Decoration.set([]);
    }

    syntaxTree(state).iterate({
      enter: ({ type, from, to }) => {
        if (type.name !== "Image") {
          return;
        }

        const text = state.sliceDoc(from, to);

        let url, alias = undefined;
        let isWikilink = false;

        mdLinkRegex.lastIndex = 0;
        wikiLinkRegex.lastIndex = 0;
        let match: RegExpMatchArray | null = null;
        if ((match = mdLinkRegex.exec(text)) && match.groups) {
          ({ url, title: alias } = match.groups);

          if (isLocalURL(url)) {
            url = resolveMarkdownLink(
              client.currentName(),
              decodeURI(url),
            );
          }
        } else if ((match = wikiLinkRegex.exec(text)) && match.groups) {
          ({ stringRef: url, alias } = match.groups);
          isWikilink = true;
        } else {
          // We found no match
          return;
        }

        let dimension: ContentDimensions | undefined;
        if (alias) {
          ({ alias, dimension: dimension } = parseDimensionFromAlias(alias));
        } else {
          alias = "";
        }

        if (!isCursorInRange(state, [from, to])) {
          widgets.push(invisibleDecoration.range(from, to));
        }

        widgets.push(
          Decoration.widget({
            widget: new LuaWidget(
              client,
              `widget:${client.currentPath()}:${text}`,
              text,
              async () => {
                const result = await inlineHtmlFromURL(
                  client,
                  url,
                  alias,
                  dimension,
                  !isWikilink,
                );
                const content = typeof result === "string"
                  ? { markdown: result }
                  : { html: result };

                return {
                  _isWidget: true,
                  display: "block",
                  cssClasses: ["sb-inline-content"],
                  ...content,
                };
              },
              true,
              true,
            ),
            block: true,
          }).range(to + 1),
        );
      },
    });

    return Decoration.set(widgets, true);
  });
}
