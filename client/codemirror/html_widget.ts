import type { EditorState, Range } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { Decoration, WidgetType } from "@codemirror/view";
import {
  decoratorStateField,
  invisibleDecoration,
  isCursorInRange,
} from "./util.ts";
import { renderMarkdownToHtml } from "../markdown_renderer/markdown_render.ts";
import { expandMarkdown } from "../markdown_renderer/inline.ts";
import type { ParseTree } from "@silverbulletmd/silverbullet/lib/tree";
import { lezerToParseTree } from "../markdown_parser/parse_tree.ts";
import type { Client } from "../client.ts";
import {
  attachWidgetEventHandlers,
  buildTranslateUrls,
} from "./widget_util.ts";
import { matchHtmlTagPairs, parseHtmlTag } from "./html_element.ts";

/**
 * Widget that renders an HTMLBlock or a slice of inline HTML as HTML, by
 * delegating to the existing markdown-to-HTML renderer.
 */
class HtmlWidget extends WidgetType {
  constructor(
    readonly client: Client,
    readonly tree: ParseTree,
    readonly cacheKey: string,
    readonly inline: boolean,
    readonly sourceText: string,
  ) {
    super();
  }

  override get estimatedHeight(): number {
    return this.client.widgetCache.getCachedWidgetHeight(this.cacheKey);
  }

  override eq(other: WidgetType): boolean {
    return (
      other instanceof HtmlWidget &&
      other.cacheKey === this.cacheKey &&
      other.inline === this.inline
    );
  }

  toDOM(): HTMLElement {
    const dom = document.createElement(this.inline ? "span" : "div");
    dom.classList.add("sb-html-widget");
    if (this.inline) {
      dom.classList.add("sb-html-widget-inline");
    }

    void expandMarkdown(
      this.client.space,
      this.client.currentName(),
      this.tree,
      this.client.clientSystem.spaceLuaEnv,
      {
        syntaxExtensions: this.client.config.get("syntaxExtensions", {}),
      },
    ).then((t) => {
      dom.innerHTML = renderMarkdownToHtml(t, {
        annotationPositions: true,
        shortWikiLinks: this.client.config.get("shortWikiLinks", false),
        translateUrls: buildTranslateUrls(this.client),
      });
      setTimeout(() => {
        attachWidgetEventHandlers(dom, this.client, this.sourceText);
        this.client.widgetCache.setCachedWidgetMeta(this.cacheKey, {
          height: dom.clientHeight,
          block: true,
        });
      });
    });

    return dom;
  }
}

/**
 * Live preview for block-level HTML (e.g. <details>, <div>, ...).
 *
 * Replaces the entire HTMLBlock node with a widget when the cursor is
 * outside the block.
 */
export function htmlBlockPlugin(client: Client) {
  return decoratorStateField((state: EditorState) => {
    const widgets: Range<Decoration>[] = [];
    syntaxTree(state).iterate({
      enter: (node) => {
        if (node.name !== "HTMLBlock") return;
        const { from, to } = node;
        if (isCursorInRange(state, [from, to])) return;

        const sourceText = state.sliceDoc(from, to);
        const parseTree = lezerToParseTree(
          state.sliceDoc(0, to),
          node.node,
        );

        widgets.push(invisibleDecoration.range(from, to));
        widgets.push(
          Decoration.widget({
            widget: new HtmlWidget(
              client,
              parseTree,
              `htmlblock:${sourceText}`,
              false,
              sourceText,
            ),
            block: false,
            side: -1,
          }).range(from),
        );
      },
    });
    return Decoration.set(widgets, true);
  });
}

/**
 * Live preview for inline HTML tags inside paragraphs (e.g. <kbd>, <marquee>,
 * <sub>, ...).
 *
 * For each paragraph that contains matched HTML tag pairs, replaces only
 * the matched <open>...</close> range with an inline widget, leaving the
 * surrounding paragraph text editable. Self-closing/void elements (e.g.
 * <br/>, <img/>) are replaced individually.
 *
 * Cursor inside a matched range falls back to raw source for that range.
 * Unmatched/orphan HTMLTag nodes are left alone (they render as literal
 * text in the read-only renderer too).
 */
export function htmlInlinePlugin(client: Client) {
  return decoratorStateField((state: EditorState) => {
    const widgets: Range<Decoration>[] = [];

    // Inline HTML can occur inside any block that hosts inline content:
    // paragraphs, headings, table cells.
    const inlineHostBlocks = new Set([
      "Paragraph",
      "ATXHeading1",
      "ATXHeading2",
      "ATXHeading3",
      "ATXHeading4",
      "ATXHeading5",
      "ATXHeading6",
      "SetextHeading1",
      "SetextHeading2",
      "TableCell",
    ]);

    syntaxTree(state).iterate({
      enter: (node) => {
        if (!inlineHostBlocks.has(node.name)) return;

        // Collect HTMLTag children of this paragraph.
        const tagInfos: {
          from: number;
          to: number;
          text: string;
          tagName: string;
          isClosing: boolean;
          isSelfClosing: boolean;
          attributes: string;
          parsedAttrs: Record<string, string>;
        }[] = [];

        let child = node.node.firstChild;
        while (child) {
          if (child.name === "HTMLTag") {
            const text = state.sliceDoc(child.from, child.to);
            const parsed = parseHtmlTag(text);
            if (parsed) {
              tagInfos.push({
                from: child.from,
                to: child.to,
                text,
                ...parsed,
              });
            }
          }
          child = child.nextSibling;
        }

        if (tagInfos.length === 0) return;

        const { pairs, voidElements } = matchHtmlTagPairs(tagInfos);
        if (pairs.length === 0 && voidElements.length === 0) return;

        // Lazily compute the paragraph ParseTree once if any range qualifies.
        let paragraphTree: ParseTree | null = null;
        const getParagraphTree = (): ParseTree => {
          if (!paragraphTree) {
            paragraphTree = lezerToParseTree(
              state.sliceDoc(0, node.to),
              node.node,
            );
          }
          return paragraphTree;
        };

        const emitWidget = (rangeFrom: number, rangeTo: number) => {
          if (isCursorInRange(state, [rangeFrom, rangeTo])) return;

          const ptree = getParagraphTree();
          // Pick out the children of the paragraph that fall within the
          // matched range. lezerToParseTree interleaves text fillers between
          // structural children, and the same [from,to] check picks both up.
          const childrenInRange = (ptree.children ?? []).filter((c) =>
            c.from !== undefined &&
            c.to !== undefined &&
            c.from >= rangeFrom &&
            c.to <= rangeTo
          );
          if (childrenInRange.length === 0) return;

          const synthetic: ParseTree = {
            type: "Paragraph",
            from: rangeFrom,
            to: rangeTo,
            children: childrenInRange,
          };

          const sourceText = state.sliceDoc(rangeFrom, rangeTo);
          widgets.push(
            Decoration.replace({
              widget: new HtmlWidget(
                client,
                synthetic,
                `htmlinline:${sourceText}`,
                true,
                sourceText,
              ),
            }).range(rangeFrom, rangeTo),
          );
        };

        for (const pair of pairs) {
          emitWidget(pair.open.from, pair.close.to);
        }
        for (const v of voidElements) {
          emitWidget(v.from, v.to);
        }
      },
    });

    return Decoration.set(widgets, true);
  });
}
