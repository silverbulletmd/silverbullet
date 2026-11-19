import { iconSvg, loadIcons } from "../../../plug-api/ui/icons/registry.ts";

/**
 * Adapts the shared icon registry to the navigator's pre-built nodes: rows
 * clone an Element per render, so each distinct icon is parsed once.
 */
export class IconResolver {
  private nodeCache = new Map<string, Element | undefined>();

  iconNode(icon: string | undefined): Element | undefined {
    const svg = iconSvg(icon);
    if (!svg) return undefined;
    if (this.nodeCache.has(svg)) return this.nodeCache.get(svg);
    const template = document.createElement("template");
    template.innerHTML = svg;
    const node = template.content.firstElementChild ?? undefined;
    this.nodeCache.set(svg, node);
    return node;
  }

  /** Waits for the full icon set, so rows don't render placeholders. */
  async resolveIcons(_icons: (string | undefined)[]): Promise<void> {
    await loadIcons();
  }
}
