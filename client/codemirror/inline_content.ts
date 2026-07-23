import type { EditorState, Range } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { Decoration } from "@codemirror/view";
import {
  decoratorStateField,
  invisibleDecoration,
  isCursorInRange,
  widgetRenderMode,
} from "./util.ts";
import type { Client } from "../client.ts";
import { LuaWidget } from "./lua_widget.ts";
import { LoadingWidget } from "./loading_widget.ts";
import {
  createMediaElement,
  expandMarkdown,
  readTransclusionContent,
} from "../markdown_renderer/inline.ts";
import { renderMarkdownToHtml } from "../markdown_renderer/markdown_render.ts";
import {
  isLocalURL,
  resolveMarkdownLink,
} from "@silverbulletmd/silverbullet/lib/resolve";
import { buildExtendedMarkdownLanguage } from "../markdown_parser/parser.ts";
import { parse } from "../markdown_parser/parse_tree.ts";
import { renderToText } from "@silverbulletmd/silverbullet/lib/tree";
import {
  nameFromTransclusion,
  parseTransclusion,
} from "@silverbulletmd/silverbullet/lib/transclusion";
import { parseToRef } from "@silverbulletmd/silverbullet/lib/ref";
import { buildTranslateUrls } from "./widget_util.ts";

export function inlineContentPlugin(client: Client) {
  return decoratorStateField((state: EditorState) => {
    const widgets: Range<Decoration>[] = [];
    const renderMode = widgetRenderMode(client);
    if (renderMode === "disabled") {
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

        if (renderMode === "loading") {
          widgets.push(
            Decoration.widget({
              widget: new LoadingWidget(true),
              block: true,
            }).range(from),
          );
          return;
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
                if (
                  isLocalURL(transclusion.url) &&
                  transclusion.linktype !== "wikilink"
                ) {
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
                    const syntaxExtensions = client.config.get(
                      "syntaxExtensions",
                      {},
                    );
                    const mdLang =
                      buildExtendedMarkdownLanguage(syntaxExtensions);
                    const expandedTree = await expandMarkdown(
                      client.space,
                      nameFromTransclusion(transclusion),
                      parse(mdLang, result.text, result.offset),
                      client.clientSystem.spaceLuaEnv,
                      { syntaxExtensions },
                    );
                    content = {
                      html: renderMarkdownToHtml(
                        expandedTree,
                        {
                          shortWikiLinks: client.config.get(
                            "shortWikiLinks",
                            true,
                          ),
                          translateUrls: buildTranslateUrls(client),
                        },
                        client.ui.viewState.allPages,
                      ),
                      markdown: renderToText(expandedTree),
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
