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
import { LuaWidget } from "./lua_widget.ts";
import {
  createMediaElement,
  expandMarkdown,
  readTransclusionContent,
} from "../markdown_renderer/inline.ts";
import {
  isLocalURL,
  resolveMarkdownLink,
} from "@silverbulletmd/silverbullet/lib/resolve";
import { parseMarkdown } from "../markdown_parser/parser.ts";
import { renderToText } from "@silverbulletmd/silverbullet/lib/tree";
import {
  nameFromTransclusion,
  parseTransclusion,
} from "@silverbulletmd/silverbullet/lib/transclusion";
import { parseToRef } from "@silverbulletmd/silverbullet/lib/ref";

export function inlineContentPlugin(client: Client) {
  return decoratorStateField((state: EditorState) => {
    const widgets: Range<Decoration>[] = [];
    if (!shouldRenderWidgets(client)) {
      // console.info("Not rendering widgets");
      return Decoration.set([]);
    }

    syntaxTree(state).iterate({
      enter: ({ type, from, to }) => {
        if (type.name !== "Image") {
          return;
        }

        const text = state.sliceDoc(from, to);

        const transclusion = parseTransclusion(text);
        if (!transclusion) {
          return;
        }

        const renderingSyntax =
          client.ui.viewState.uiOptions.markdownSyntaxRendering;
        const cursorIsInRange = isCursorInRange(state, [from, to]);
        if (cursorIsInRange) {
          return;
        }
        if (!renderingSyntax && !cursorIsInRange) {
          widgets.push(invisibleDecoration.range(from, to));
        }

        widgets.push(
          Decoration.widget({
            widget: new LuaWidget({
              client,
              cacheKey: `widget:${client.currentPath()}:${text}`,
              expressionText: text,
              codeText: text,
              renderEmpty: true,
              inPage: true,
              openRef: parseToRef(transclusion.url),
              callback: async () => {
                // Resolve local URLs (only for markdown links, wikilinks are absolute)
                if (isLocalURL(transclusion.url) && transclusion.linktype !== "wikilink") {
                  transclusion.url = resolveMarkdownLink(
                    client.currentName(),
                    decodeURI(transclusion.url),
                  );
                }

                try {
                  let content;
                  try {
                    const result = await readTransclusionContent(
                      client.space,
                      transclusion,
                    );
                    content = {
                      markdown: renderToText(
                        await expandMarkdown(
                          client.space,
                          nameFromTransclusion(transclusion),
                          parseMarkdown(result.text, result.offset),
                          client.clientSystem.spaceLuaEnv,
                          {
                            syntaxExtensions: client.config.get(
                              "syntaxExtensions",
                              {},
                            ),
                          },
                        ),
                      ),
                    };
                  } catch {
                    const element = createMediaElement(transclusion);
                    if (!element) {
                      throw new Error(
                        `Unsupported content: ${transclusion.url}`,
                      );
                    }
                    content = { html: element };
                  }

                  return {
                    _isWidget: true,
                    display: "block",
                    cssClasses: ["sb-inline-content"],
                    ...content,
                  };
                } catch (e: any) {
                  return {
                    _isWidget: true,
                    display: "block",
                    cssClasses: ["sb-inline-content"],
                    markdown: `**Error:** ${e.message}`,
                  };
                }
              },
            }),
            block: true,
          }).range(from),
        );
      },
    });

    return Decoration.set(widgets, true);
  });
}
