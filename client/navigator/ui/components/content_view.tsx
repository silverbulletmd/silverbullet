import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { Client } from "../../../client.ts";
import { bindWidgetEvents } from "../../../codemirror/widgets/widget_body.ts";
import { attachWidgetEventHandlers } from "../../../codemirror/widgets/widget_util.ts";
import {
  disposeRendered,
  renderValue,
} from "../../../markdown_renderer/compose.ts";
import { liveContextForClient } from "../../../markdown_renderer/compose_client.ts";
import { copyValue } from "../../../codemirror/widgets/directive_actions.ts";
import type { ContentState } from "../../page_widget_logic.ts";

/**
 * Mounts already-rendered content markdown and wires it up:
 * `attachWidgetEventHandlers` is what makes a wiki link navigate locally, a
 * command button run its command, and a task checkbox tick through to the page
 * the task actually lives on.
 */
export function ContentNode({
  client,
  node,
  cssClasses,
  events,
}: {
  client: Client;
  node: HTMLElement;
  cssClasses?: string[];
  events?: ContentState["events"];
}) {
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    el.replaceChildren(node);
    attachWidgetEventHandlers(el, client);
    const unbind = bindWidgetEvents(el, events);
    // The node belongs to `useRenderedValue`, which disposes it: a collapsed
    // frame re-mounts the same node when it expands
    return () => {
      unbind();
      node.remove();
    };
  }, [node]);
  return (
    <div
      className={["sb-nav-content", ...(cssClasses ?? [])].join(" ")}
      ref={host}
    />
  );
}

export async function renderContent(
  client: Client,
  value: unknown,
  pageName: string,
): Promise<ContentState> {
  const context = () => liveContextForClient(client, { sourcePage: pageName });
  const rendered = await renderValue(value, context());
  return {
    copy: rendered.copyable
      ? () => copyValue(client, value, context())
      : undefined,
    node: rendered.empty ? undefined : rendered.node,
    cssClasses: rendered.chrome.cssClasses,
    events: rendered.chrome.events,
  };
}

/**
 * Renders a content value. Until a newer value has rendered, the previous
 * render stays (`current` is false meanwhile). Every render is disposed here,
 * whether it was ever shown or not: once replaced, on unmount, or on landing
 * after it lost the race.
 */
export function useRenderedValue(
  client: Client,
  value: unknown,
  pageName: string,
): { content: ContentState | undefined; current: boolean } {
  const [state, setState] = useState<{
    value: unknown;
    pageName: string;
    content: ContentState;
  }>();
  useEffect(() => {
    if (value === undefined) return;
    let live = true;
    renderContent(client, value, pageName).then(
      (content) => {
        if (live) setState({ value, pageName, content });
        else if (content.node) disposeRendered(content.node);
      },
      (e) => {
        if (!live) return;
        console.error("navigator content view: render failed", e);
        setState({
          value,
          pageName,
          content: { error: e?.message ?? String(e) },
        });
      },
    );
    return () => {
      live = false;
    };
  }, [value, pageName]);
  useEffect(() => {
    const node = state?.content.node;
    return () => {
      if (node) disposeRendered(node);
    };
  }, [state]);
  if (value === undefined) return { content: undefined, current: false };
  return {
    content: state?.content,
    current: state?.value === value && state.pageName === pageName,
  };
}
