import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { renderToText } from "@silverbulletmd/silverbullet/lib/tree";
import { CopyIcon } from "./chrome_icons.tsx";
import type { Client } from "../../../client.ts";
import { parseHtmlString } from "../../../codemirror/lua_widget.ts";
import {
  attachWidgetEventHandlers,
  buildResolveTransclusion,
  buildTranslateUrls,
} from "../../../codemirror/widget_util.ts";
import { parse } from "../../../markdown_parser/parse_tree.ts";
import { buildExtendedMarkdownLanguage } from "../../../markdown_parser/parser.ts";
import { expandMarkdown } from "../../../markdown_renderer/inline.ts";
import { renderMarkdownToHtml } from "../../../markdown_renderer/markdown_render.ts";

/**
 * A *content* view's body: the markdown its `content` function returned,
 * rendered exactly the way an in-editor Lua widget renders its own markdown.
 */
export async function renderContentMarkdown(
  client: Client,
  markdown: string,
): Promise<HTMLElement | undefined> {
  if (!markdown.trim()) return undefined;
  const syntaxExtensions = client.config.get("syntaxExtensions", {});
  const pageName = client.currentName();
  const resolveTransclusion = buildResolveTransclusion(client);
  let tree = await expandMarkdown(
    client.space,
    pageName,
    parse(buildExtendedMarkdownLanguage(syntaxExtensions), markdown),
    client.clientSystem.spaceLuaEnv,
    {
      rewriteTasks: true,
      syntaxExtensions,
      resolveTransclusion,
    },
  );
  tree = await expandMarkdown(
    client.space,
    pageName,
    parse(
      buildExtendedMarkdownLanguage(syntaxExtensions),
      renderToText(tree).trim(),
    ),
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
        resolveTransclusion,
      },
      client.ui.viewState.allPages,
    ),
  );
}

/**
 * Mounts already-rendered content markdown and wires it up:
 * `attachWidgetEventHandlers` is what makes a wiki link navigate locally, a
 * command button run its command, and a task checkbox tick through to the page
 * the task actually lives on.
 */
export function ContentNode({
  client,
  node,
}: {
  client: Client;
  node: HTMLElement;
}) {
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    el.replaceChildren(node);
    attachWidgetEventHandlers(el, client);
  }, [node]);
  return <div className="sb-nav-content" ref={host} />;
}

export function ContentBody({
  client,
  markdown,
  onPainted,
}: {
  client: Client;
  markdown: string;
  onPainted?: (markdown: string) => void;
}) {
  const [result, setResult] = useState<
    { markdown: string; node?: HTMLElement; error?: string } | undefined
  >(undefined);

  useEffect(() => {
    let live = true;
    renderContentMarkdown(client, markdown)
      .then((rendered) => {
        if (!live) return;
        setResult({ markdown, node: rendered });
      })
      .catch((e) => {
        if (!live) return;
        console.error("navigator content view: markdown render failed", e);
        setResult({ markdown, error: e?.message ?? String(e) });
      });
    return () => {
      live = false;
    };
  }, [markdown]);

  useLayoutEffect(() => {
    if (!result) return;
    onPainted?.(result.markdown);
  }, [result]);

  if (result?.error !== undefined) {
    return (
      <div className="sb-nav-error sb-nav-error-inline">{result.error}</div>
    );
  }
  if (!result?.node) return <div className="sb-nav-content" />;
  return <ContentNode client={client} node={result.node} />;
}

export function CopyMarkdownButton({
  client,
  markdown,
}: {
  client: Client;
  markdown: string;
}) {
  return (
    <button
      type="button"
      className="sb-nav-copy"
      data-button="copy"
      title="Copy"
      aria-label="Copy markdown"
      onClick={(e) => {
        e.stopPropagation();
        client.clientSystem
          .localSyscall("editor.copyToClipboard", [markdown.trim()])
          .catch(console.error);
      }}
    >
      <CopyIcon />
    </button>
  );
}
