import { syntaxTree } from "@codemirror/language";
import type { EditorState, Range } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import { parseToRef } from "@silverbulletmd/silverbullet/lib/ref";
import {
  isLocalURL,
  resolveMarkdownLink,
} from "@silverbulletmd/silverbullet/lib/resolve";
import {
  nameFromTransclusion,
  parseTransclusion,
  resolveTransclusionUrl,
} from "@silverbulletmd/silverbullet/lib/transclusion";
import type { Client } from "../../client.ts";
import { parse } from "../../markdown_parser/parse_tree.ts";
import { buildExtendedMarkdownLanguage } from "../../markdown_parser/parser.ts";
import { renderMarkdown } from "../../markdown_renderer/compose.ts";
import { liveContextForClient } from "../../markdown_renderer/compose_client.ts";
import {
  createMediaElement,
  readTransclusionContent,
} from "../../markdown_renderer/inline.ts";
import {
  decoratorStateField,
  invisibleDecoration,
  isCursorInRange,
  widgetRenderMode,
} from "../util.ts";
import { LoadingWidget } from "../widgets/loading_widget.ts";
import { LuaWidget } from "../widgets/lua_widget.ts";

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
        resolveTransclusionUrl(
          transclusion,
          client.currentPath(),
          client.clientSystem.allKnownFiles,
        );

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
              host: {
                kind: "transclusion",
                codeText: text,
                openRef: parseToRef(transclusion.url),
              },
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
                    const tree = parse(mdLang, result.text, result.offset);
                    if (result.offset === 0 && tree.children) {
                      tree.children = tree.children.filter(
                        (c) => c.type !== "FrontMatter",
                      );
                    }
                    const { node, copyMarkdown } = await renderMarkdown(
                      tree,
                      liveContextForClient(client, {
                        sourcePage: nameFromTransclusion(transclusion),
                        taskRefs: "page",
                      }),
                    );
                    content = { html: node, markdown: copyMarkdown };
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
