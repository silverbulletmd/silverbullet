import {
  iconNames,
  iconSvgOrNull,
  loadIcons,
} from "../../../plug-api/ui/icons/registry.ts";
import type { SysCallMapping } from "../system.ts";

async function svg(name: unknown): Promise<string | null> {
  if (typeof name !== "string" || !name) return null;
  await loadIcons();
  return iconSvgOrNull(name);
}

async function resolve(names: unknown): Promise<Record<string, string>> {
  await loadIcons();
  const out: Record<string, string> = {};
  for (const name of Array.isArray(names) ? names : []) {
    if (typeof name !== "string") continue;
    const markup = iconSvgOrNull(name);
    if (markup) out[name] = markup;
  }
  return out;
}

const warned = new Set<string>();
function deprecated(old: string, replacement: string) {
  if (warned.has(old)) return;
  warned.add(old);
  console.warn(`${old} is deprecated; use ${replacement}`);
}

export function iconSyscalls(): SysCallMapping {
  return {
    "icon.svg": {
      callback: (_ctx, name: string) => svg(name),
      description:
        "Renders a [Lucide](https://lucide.dev/icons) icon to SVG markup by name, or nil when the name isn't an icon. The markup carries no color of its own (`currentColor`) and a default 24x24 size, both of which CSS at the injection site can override.",
      parameters: [
        {
          name: "name",
          type: "string",
          description: "A Lucide icon name, e.g. `trash-2`.",
        },
      ],
      returns: [
        {
          type: "string",
          description: "The icon's SVG markup, or nil when unknown.",
        },
      ],
      examples: [{ code: 'local lock = icon.svg("lock")' }],
    },
    "icon.resolve": {
      callback: (_ctx, names: string[]) => resolve(names),
      description:
        "Renders a batch of Lucide icons to SVG markup in one round trip, so panels can show icons without bundling the icon set themselves. Unknown names are omitted from the result. The markup carries no color of its own (`currentColor`) and a default 24x24 size, both of which CSS at the injection site can override.",
      parameters: [
        {
          name: "names",
          type: "table",
          description: "Lucide icon names, e.g. `trash-2`.",
        },
      ],
      returns: [
        { type: "table", description: "Map of icon name to SVG markup." },
      ],
    },
    "icon.names": {
      callback: async () => {
        await loadIcons();
        return iconNames();
      },
      description: "Lists every available Lucide icon name, sorted.",
      parameters: [],
      returns: [{ type: "table", description: "Icon names." }],
    },
    "icon.feather": {
      callback: (_ctx, name: string) => {
        deprecated("icon.feather", "icon.svg");
        return svg(name);
      },
      description: "Deprecated: use `icon.svg`.",
      parameters: [{ name: "name", type: "string", description: "Icon name." }],
      returns: [{ type: "string", description: "SVG markup, or nil." }],
    },
    "icon.resolveFeather": {
      callback: (_ctx, names: string[]) => {
        deprecated("icon.resolveFeather", "icon.resolve");
        return resolve(names);
      },
      description: "Deprecated: use `icon.resolve`.",
      parameters: [
        { name: "names", type: "table", description: "Icon names." },
      ],
      returns: [{ type: "table", description: "Map of name to SVG markup." }],
    },
  };
}
