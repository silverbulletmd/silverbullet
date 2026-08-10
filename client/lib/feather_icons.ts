import { h, render } from "preact";
import * as featherIcons from "preact-feather";

/**
 * Feather icon names are kebab-case
 */
export function kebabToPascal(name: string): string {
  return name
    .replace(/-(\w)/g, (_, c: string) => c.toUpperCase())
    .replace(/^./, (c) => c.toUpperCase());
}

/**
 * Serializes the named Feather icons to standalone SVG markup, for consumers
 * that can't import the icon set themselves.
 */
export function resolveFeatherIcons(names: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const container = document.createElement("div");
  for (const name of new Set(names)) {
    const Icon = (featherIcons as Record<string, any>)[kebabToPascal(name)];
    if (!Icon) continue;
    // Detached: never attached to the document, so this costs no layout.
    render(h(Icon, {}), container);
    const svg = container.firstElementChild;
    if (svg) out[name] = svg.outerHTML;
  }
  render(null, container);
  return out;
}
