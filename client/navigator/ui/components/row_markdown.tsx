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
  pageName = client.currentName(),
  inline = false,
): Promise<HTMLElement | undefined> {
  if (!text || !needsMarkdown(text)) return undefined;
  try {
    const syntaxExtensions = client.config.get("syntaxExtensions", {});
    const tree = await expandMarkdown(
      client.space,
      pageName,
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
          ...(inline ? { inline: true as const } : {}),
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
 * A tree reads as structure rather than content, so its labels render
 * inline-only: no block construct can appear -- a header named "1. Foo" must
 * not become a list -- while inline syntax, attributes above all, still
 * styles (#1914).
 *
 * Keyed by row rather than returned on it: `Row` is the view-facing wire type
 * and has no business carrying a DOM node, and the tree's own nodes are built
 * from these very row objects.
 *
 * Both tree surfaces call this -- the page-docked widget through
 * `document_view.tsx` and the sidebar panels through `nav_root.tsx` -- because
 * each owns its own row pipeline.
 */
export async function renderTreeLabels(
  client: Client,
  rows: Row[],
  pageName = client.currentName(),
): Promise<WeakMap<Row, HTMLElement>> {
  const labelNodes = new WeakMap<Row, HTMLElement>();
  await Promise.all(
    rows.map(async (row) => {
      if (!row.label) return;
      const node = await renderRowMarkdown(client, row.label, pageName, true);
      if (!node) return;
      // Same wiring every other rendered widget gets: a wiki link navigates
      // in-app instead of reloading the page.
      attachWidgetEventHandlers(node, client);
      labelNodes.set(row, node);
    }),
  );
  return labelNodes;
}

/**
 * Tree rows are left plain here: their labels are rendered separately by
 * `renderTreeLabels`, which both tree surfaces share.
 */
export function renderRows(
  client: Client,
  rows: Row[],
  isTree: boolean,
  pageName = client.currentName(),
): Promise<RenderedRow[]> {
  if (isTree) return Promise.resolve(rows.map((row) => ({ row })));
  return Promise.all(
    rows.map(async (row) => ({
      row,
      primaryNode: await renderRowMarkdown(client, row.primary ?? "", pageName),
      descriptionNode:
        typeof row.description === "string"
          ? await renderRowMarkdown(client, row.description, pageName)
          : undefined,
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
