import { useLayoutEffect, useRef } from "preact/hooks";
import type { Client } from "../../../client.ts";
import { parseHtmlString } from "../../../codemirror/lua_widget.ts";
import {
  attachWidgetEventHandlers,
  buildTranslateUrls,
} from "../../../codemirror/widget_util.ts";
import { parse } from "../../../markdown_parser/parse_tree.ts";
import { buildExtendedMarkdownLanguage } from "../../../markdown_parser/parser.ts";
import { expandMarkdown } from "../../../markdown_renderer/inline.ts";
import { renderMarkdownToHtml } from "../../../markdown_renderer/markdown_render.ts";
import { needsMarkdown } from "../../page_widget_logic.ts";
import type { Row } from "../../types.ts";

/**
 * A *row's* markdown, the row-side counterpart to `content_view.tsx`: a row's
 * primary and description are short inline strings rather than a document, so
 * they skip transclusion and Lua expansion entirely.
 */
export async function renderRowMarkdown(
  client: Client,
  text: string,
): Promise<HTMLElement | undefined> {
  if (!text || !needsMarkdown(text)) return undefined;
  try {
    const syntaxExtensions = client.config.get("syntaxExtensions", {});
    const tree = await expandMarkdown(
      client.space,
      client.currentName(),
      parse(buildExtendedMarkdownLanguage(syntaxExtensions), text),
      client.clientSystem.spaceLuaEnv,
      {
        expandTransclusions: false,
        expandLuaDirectives: false,
        rewriteTasks: false,
        syntaxExtensions,
      },
    );
    return parseHtmlString(
      renderMarkdownToHtml(
        tree,
        {
          shortWikiLinks: client.config.get("shortWikiLinks", true),
          translateUrls: buildTranslateUrls(client),
        },
        client.ui.viewState.allPages,
      ),
    );
  } catch (e) {
    console.error("navigator page widget: markdown render failed", e);
    return undefined;
  }
}

/** A row plus whatever of its text rendered to markdown HTML. */
export type RenderedRow = {
  row: Row;
  primaryNode?: HTMLElement;
  descriptionNode?: HTMLElement;
};

/**
 * Tree rows are left plain: their text is a header label, and a tree reads as
 * structure rather than content.
 */
export function renderRows(
  client: Client,
  rows: Row[],
  isTree: boolean,
): Promise<RenderedRow[]> {
  if (isTree) return Promise.resolve(rows.map((row) => ({ row })));
  return Promise.all(
    rows.map(async (row) => ({
      row,
      primaryNode: await renderRowMarkdown(client, row.primary ?? ""),
      descriptionNode: await renderRowMarkdown(client, row.description ?? ""),
    })),
  );
}

/**
 * Mounts pre-rendered markdown HTML into the row, and wires it up the way
 * every other in-editor widget does: `attachWidgetEventHandlers` gives wiki
 * links a local navigate and stops their clicks from also reaching the row.
 */
export function MarkdownText({
  node,
  className,
  client,
}: {
  node: HTMLElement;
  className: string;
  client: Client;
}) {
  const host = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    el.replaceChildren(node);
    attachWidgetEventHandlers(el, client);
  }, [node]);
  return <span ref={host} className={className} />;
}
