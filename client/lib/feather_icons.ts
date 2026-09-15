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
  for (const name of new Set(names)) {
    const Icon = (featherIcons as Record<string, any>)[kebabToPascal(name)];
    if (!Icon) continue;
    out[name] = renderVNode(Icon({}));
  }
  return out;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function renderVNode(value: any): string {
  if (value === null || value === undefined || value === false) return "";
  if (Array.isArray(value)) return value.map(renderVNode).join("");
  if (typeof value === "string" || typeof value === "number") {
    return escapeHtml(String(value));
  }
  if (typeof value.type === "function") {
    return renderVNode(value.type(value.props));
  }

  const props = value.props ?? {};
  const attrs = Object.entries(props)
    .filter(
      ([name, attribute]) =>
        name !== "children" &&
        attribute !== null &&
        attribute !== undefined &&
        attribute !== false,
    )
    .map(([name, attribute]) => {
      const htmlName = name === "className" ? "class" : name;
      return `${htmlName}="${escapeHtml(String(attribute))}"`;
    })
    .join(" ");
  const opening = attrs ? `<${value.type} ${attrs}>` : `<${value.type}>`;
  return `${opening}${renderVNode(props.children)}</${value.type}>`;
}
