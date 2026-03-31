import type { EditorState, Range } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { Decoration, WidgetType } from "@codemirror/view";
import {
  decoratorStateField,
  invisibleDecoration,
  isCursorInRange,
  shouldRenderWidgets,
} from "./util.ts";
import type { Client } from "../client.ts";
import { renderMarkdownToHtml } from "../markdown_renderer/markdown_render.ts";
import { parseMarkdown } from "../markdown_parser/parser.ts";
import {
  attachWidgetEventHandlers,
  buildTranslateUrls,
} from "./widget_util.ts";

export type ParsedTag = {
  tagName: string;
  attributes: string;
  parsedAttrs: Record<string, string>;
  isClosing: boolean;
  isSelfClosing: boolean;
};

type TagInfo = ParsedTag & {
  from: number;
  to: number;
  text: string;
};

export type MatchedPair = {
  open: TagInfo;
  close: TagInfo;
};

const TAG_REGEX = /^<(\/?)([a-zA-Z][\w-]*)((?:\s[^>]*?)?)\s*(\/?)>$/s;

const ATTR_REGEX =
  /([a-zA-Z:_][\w\-.:]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+)))?/g;

const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

export function parseHtmlTag(text: string): ParsedTag | null {
  const match = TAG_REGEX.exec(text);
  if (!match) return null;
  const rawAttrs = match[3].trim();
  const parsedAttrs: Record<string, string> = {};
  if (rawAttrs) {
    let attrMatch;
    ATTR_REGEX.lastIndex = 0;
    while ((attrMatch = ATTR_REGEX.exec(rawAttrs)) !== null) {
      parsedAttrs[attrMatch[1]] =
        attrMatch[2] ?? attrMatch[3] ?? attrMatch[4] ?? "";
    }
  }
  return {
    tagName: match[2],
    isClosing: match[1] === "/",
    attributes: rawAttrs,
    parsedAttrs,
    isSelfClosing:
      match[4] === "/" || VOID_ELEMENTS.has(match[2].toLowerCase()),
  };
}

export function matchHtmlTagPairs(tags: TagInfo[]): {
  pairs: MatchedPair[];
  voidElements: TagInfo[];
} {
  const pairs: MatchedPair[] = [];
  const voidElements: TagInfo[] = [];
  const stack: TagInfo[] = [];

  for (const tag of tags) {
    if (tag.isSelfClosing) {
      voidElements.push(tag);
      continue;
    }
    if (tag.isClosing) {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tagName.toLowerCase() === tag.tagName.toLowerCase()) {
          pairs.push({ open: stack[i], close: tag });
          stack.splice(i, 1);
          break;
        }
      }
    } else {
      stack.push(tag);
    }
  }

  return { pairs, voidElements };
}

class HtmlWidget extends WidgetType {
  constructor(
    readonly client: Client,
    readonly openTag: string,
    readonly closeTag: string,
    readonly innerText: string,
    readonly sourceText: string,
    readonly block: boolean,
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const wrapper = document.createElement(this.block ? "div" : "span");
    wrapper.classList.add(
      this.block ? "sb-html-block-widget" : "sb-html-inline-widget",
    );

    wrapper.addEventListener("click", () => {
      const pos = this.client.editorView.posAtDOM(wrapper, 0);
      this.client.editorView.dispatch({ selection: { anchor: pos } });
    });

    const innerHtml = this.innerText
      ? renderMarkdownToHtml(parseMarkdown(this.innerText), {
        translateUrls: buildTranslateUrls(this.client),
      })
      : "";

    wrapper.innerHTML = `${this.openTag}${innerHtml}${this.closeTag}`;
    setTimeout(() => {
      attachWidgetEventHandlers(wrapper, this.client, this.sourceText);
    });

    return wrapper;
  }

  override eq(other: WidgetType): boolean {
    return (
      other instanceof HtmlWidget && other.sourceText === this.sourceText
    );
  }
}

export function htmlElementPlugin(client: Client) {
  return decoratorStateField((state: EditorState) => {
    const widgets: Range<Decoration>[] = [];
    if (!shouldRenderWidgets(client)) {
      return Decoration.set([]);
    }

    syntaxTree(state).iterate({
      enter: (node) => {
        if (node.name === "Paragraph") {
          handleInlineHtml(state, node, widgets, client);
          return;
        }

        if (node.name === "HTMLBlock") {
          const { from, to } = node;
          if (isCursorInRange(state, [from, to])) return;

          const text = state.sliceDoc(from, to);
          const parsed = parseHtmlTag(text);
          if (!parsed) return;

          const closeMatch = text.match(/(<\/[a-zA-Z][\w-]*\s*>)\s*$/s);
          if (!closeMatch) return;

          const openTag = text.slice(0, parsed.attributes
            ? text.indexOf(">") + 1
            : parsed.tagName.length + 2);
          const closeTag = closeMatch[1];
          const closeStart = closeMatch.index!;
          const innerText = text.slice(openTag.length, closeStart);

          widgets.push(invisibleDecoration.range(from, to));
          widgets.push(
            Decoration.widget({
              widget: new HtmlWidget(
                client,
                openTag,
                closeTag,
                innerText.trim(),
                text,
                true,
              ),
              block: true,
            }).range(from),
          );
          return false;
        }
      },
    });

    return Decoration.set(widgets, true);
  });
}

function handleInlineHtml(
  state: EditorState,
  paragraphNode: { from: number; to: number; node: any },
  widgets: Range<Decoration>[],
  client: Client,
) {
  const tags: TagInfo[] = [];
  let child = paragraphNode.node.firstChild;
  while (child) {
    if (child.name === "HTMLTag") {
      const text = state.sliceDoc(child.from, child.to);
      const parsed = parseHtmlTag(text);
      if (parsed) {
        tags.push({ ...parsed, from: child.from, to: child.to, text });
      }
    }
    child = child.nextSibling;
  }

  if (tags.length === 0) return;

  const { pairs, voidElements } = matchHtmlTagPairs(tags);

  for (const { open, close } of pairs) {
    const fullFrom = open.from;
    const fullTo = close.to;
    if (isCursorInRange(state, [fullFrom, fullTo])) continue;

    const innerText = state.sliceDoc(open.to, close.from);

    widgets.push(invisibleDecoration.range(fullFrom, fullTo));
    widgets.push(
      Decoration.widget({
        widget: new HtmlWidget(
          client,
          open.text,
          close.text,
          innerText,
          open.text + innerText + close.text,
          false,
        ),
      }).range(fullFrom),
    );
  }

  for (const voidTag of voidElements) {
    if (isCursorInRange(state, [voidTag.from, voidTag.to])) continue;

    widgets.push(invisibleDecoration.range(voidTag.from, voidTag.to));
    widgets.push(
      Decoration.widget({
        widget: new HtmlWidget(client, voidTag.text, "", "", voidTag.text, false),
      }).range(voidTag.from),
    );
  }
}
