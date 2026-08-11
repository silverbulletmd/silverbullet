import { resolveFeatherIcons } from "../../lib/feather_icons.ts";
import type { SysCallMapping } from "../system.ts";

export function iconSyscalls(): SysCallMapping {
  return {
    "icon.feather": {
      callback: (_ctx, name: string): string | null => {
        if (!name) return null;
        return resolveFeatherIcons([name])[name] ?? null;
      },
      description:
        "Renders a Feather icon to SVG markup by name, or nil when the name isn't a Feather icon. The markup carries no color of its own (`currentColor`) and a default 24x24 size, both of which CSS at the injection site can override.",
      parameters: [
        {
          name: "name",
          type: "string",
          description: "A Feather icon name, e.g. `trash-2`.",
        },
      ],
      returns: [
        {
          type: "string",
          description: "The icon's SVG markup, or nil when unknown.",
        },
      ],
      examples: [{ code: 'local lock = icon.feather("lock")' }],
    },
    "icon.resolveFeather": {
      callback: (_ctx, names: string[]): Record<string, string> => {
        return resolveFeatherIcons(names ?? []);
      },
      description:
        "Renders a batch of Feather icons to SVG markup in one round trip, so panels can show icons without bundling the icon set themselves. Unknown names are omitted from the result. The markup carries no color of its own (`currentColor`) and a default 24x24 size, both of which CSS at the injection site can override.",
      parameters: [
        {
          name: "names",
          type: "table",
          description: "Feather icon names, e.g. `trash-2`.",
        },
      ],
      returns: [
        { type: "table", description: "Map of icon name to SVG markup." },
      ],
    },
  };
}
