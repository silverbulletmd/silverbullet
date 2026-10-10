import { bakedRegionText } from "../../baked_sections/regions.ts";
import type { Client } from "../../client.ts";
import {
  bakeMarkdown,
  portableMarkdown,
  type RenderContext,
} from "../../markdown_renderer/compose.ts";
import { liveContextForClient } from "../../markdown_renderer/compose_client.ts";
import type { ValuePlan } from "../../markdown_renderer/value_plan.ts";
import { activeWidgets } from "./code_widget.ts";
import { directiveAt } from "./directive_at.ts";
import { makeLiveSource, makeStaticSource } from "./live_rewrite.ts";

export type DirectiveTarget = { from: number; to: number; expr: string };

export type LiveToggle = "makeLive" | "makeStatic";

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

/**
 * Which live toggle a `${…}` offers. A top-level `widget.live(…)` call can be
 * made static. Without render information (the palette) anything else can be
 * made live; with it, values already live through a nested `widget.live`,
 * views and sandboxes can't.
 */
export function liveToggle(
  expr: string,
  render?: { live: boolean; kind: ValuePlan["kind"] },
): LiveToggle | undefined {
  if (makeStaticSource(expr) !== undefined) return "makeStatic";
  if (
    render &&
    (render.live || render.kind === "view" || render.kind === "sandbox")
  ) {
    return undefined;
  }
  return "makeLive";
}

function refuseReadOnly(client: Client): boolean {
  if (!client.isReadOnlyMode()) return false;
  client.ui.flashNotification("This page is read-only", "error");
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
  if (refuseReadOnly(client)) return;
  const result = await bakeMarkdown(value, ctx);
  if (!result.ok) {
    client.ui.flashNotification(result.reason, "error");
    return;
  }
  replace(client, target, bakedRegionText(target.expr, result.markdown));
}

export function setDirectiveLive(
  client: Client,
  target: DirectiveTarget,
  toggle: LiveToggle,
): void {
  if (refuseReadOnly(client)) return;
  const unwrapped = makeStaticSource(target.expr);
  if (toggle === "makeStatic") {
    if (unwrapped === undefined) {
      client.ui.flashNotification("This widget isn't live", "error");
      return;
    }
    replace(client, target, `\${${unwrapped}}`);
    return;
  }
  if (unwrapped !== undefined) {
    client.ui.flashNotification("This widget is already live", "error");
    return;
  }
  replace(client, target, `\${${makeLiveSource(target.expr)}}`);
}

/** Re-runs every rendered copy of `expr` on the open page. */
export async function reloadDirective(
  client: Client,
  expr: string,
): Promise<void> {
  const key = directiveCacheKey(expr, client.currentPageMeta()?.name);
  client.widgetCache.invalidatePrewarm(key);
  await Promise.all(
    [...activeWidgets].flatMap((w) =>
      w.cacheKey === key && w.reload ? [w.reload()] : [],
    ),
  );
}

function replace(client: Client, t: DirectiveTarget, insert: string): void {
  client.editorView.dispatch({ changes: { from: t.from, to: t.to, insert } });
  client.focus();
}
