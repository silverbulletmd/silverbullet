import { bakedRegionText } from "../../baked_sections/regions.ts";
import type { Client } from "../../client.ts";
import {
  bakeMarkdown,
  portableMarkdown,
  type RenderContext,
} from "../../markdown_renderer/compose.ts";
import { liveContextForClient } from "../../markdown_renderer/compose_client.ts";
import { activeWidgets } from "./code_widget.ts";
import { directiveAt } from "./directive_at.ts";

export type DirectiveTarget = {
  from: number;
  to: number;
  expr: string;
  // Set for a `${name = expr}` definition
  assignmentName?: string;
};

export function directiveCacheKey(
  expr: string,
  pageName: string | undefined,
): string {
  return `lua:${expr}:${pageName}`;
}

/** The `${…}` a rendered widget stands for; undefined once the text changed. */
export function directiveAtWidget(
  client: Client,
  dom: HTMLElement,
  expr: string,
): DirectiveTarget | undefined {
  const view = client.editorView;
  // One past the widget's position: the `$` of its own directive, never the
  // end of one right before it
  const found = directiveAt(view.state, view.posAtDOM(dom, 0) + 1);
  return found?.expr === expr ? found : undefined;
}

function refuseReadOnly(client: Client): boolean {
  if (!client.isReadOnlyMode()) return false;
  client.ui.flashNotification("This page is read-only", "error");
  return true;
}

// Rewriting an assignment would drop its definition
function refuseAssignment(
  client: Client,
  target: DirectiveTarget,
  action: string,
): boolean {
  if (!target.assignmentName) return false;
  client.ui.flashNotification(`An assignment can't be ${action}`, "error");
  return true;
}

export async function copyValue(
  client: Client,
  value: unknown,
  ctx: RenderContext = liveContextForClient(client),
): Promise<void> {
  const result = await portableMarkdown(value, ctx);
  if (!result.ok) {
    client.ui.flashNotification(result.reason, "error");
    return;
  }
  await client.clientSystem.localSyscall("editor.copyToClipboard", [
    result.markdown,
  ]);
  client.ui.flashNotification("Copied as Markdown");
}

export async function bakeDirective(
  client: Client,
  target: DirectiveTarget,
  value: unknown,
  ctx: RenderContext = liveContextForClient(client),
): Promise<void> {
  if (refuseReadOnly(client) || refuseAssignment(client, target, "baked")) {
    return;
  }
  const result = await bakeMarkdown(value, ctx);
  if (!result.ok) {
    client.ui.flashNotification(result.reason, "error");
    return;
  }
  replace(client, target, bakedRegionText(target.expr, result.markdown));
}

/** Re-runs every rendered copy of `expr` on the open page. */
export async function reloadDirective(
  client: Client,
  expr: string,
): Promise<void> {
  const key = directiveCacheKey(expr, client.currentPageMeta()?.name);
  client.widgetCache.invalidatePrewarm(key);
  // On a page with definitions the key carries the page scope's
  const matches = (cacheKey: string | undefined) =>
    cacheKey === key || !!cacheKey?.startsWith(`${key}:`);
  await Promise.all(
    [...activeWidgets].flatMap((w) =>
      matches(w.cacheKey) && w.reload ? [w.reload()] : [],
    ),
  );
}

function replace(client: Client, t: DirectiveTarget, insert: string): void {
  client.editorView.dispatch({ changes: { from: t.from, to: t.to, insert } });
  client.focus();
}
