import type { ParseTree } from "@silverbulletmd/silverbullet/lib/tree";
import {
  type ComposeOptions,
  disposeRendered,
  type RenderContext,
  renderMarkdown,
} from "./compose.ts";

// Editor widget DOMs that were destroyed; a render finishing late is dropped
const destroyedTargets = new WeakSet<Element>();

/** Call from a widget's destroy(): unmounts nested views, drops late renders. */
export function destroyRenderTarget(target: Element): void {
  destroyedTargets.add(target);
  disposeRendered(target);
}

/**
 * Renders markdown and moves the result into `target`. With `inline` the
 * paragraph wrapper is dropped. Resolves false when the target was destroyed
 * before rendering finished.
 */
export async function renderMarkdownInto(
  target: Element,
  src: string | ParseTree,
  ctx: RenderContext,
  opts: ComposeOptions & { inline?: boolean } = {},
): Promise<boolean> {
  const { node } = await renderMarkdown(src, ctx, opts);
  if (destroyedTargets.has(target)) {
    disposeRendered(node);
    return false;
  }
  const content = opts.inline ? (node.querySelector(".p, p") ?? node) : node;
  target.replaceChildren(...Array.from(content.childNodes));
  return true;
}
