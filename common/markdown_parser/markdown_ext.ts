import { Tag } from "../deps.ts";
import type { MarkdownConfig } from "../deps.ts";
import { System } from "../../plugos/system.ts";
import { Manifest, NodeDef } from "../manifest.ts";

export type MDExt = {
  // unicode char code for efficiency .charCodeAt(0)
  firstCharCodes: number[];
  regex: RegExp;
  nodeType: string;
  tag: Tag;
  styles?: { [key: string]: string };
  className?: string;
};

export function mdExtensionSyntaxConfig({
  regex,
  firstCharCodes,
  nodeType,
}: MDExt): MarkdownConfig {
  return {
    defineNodes: [nodeType],
    parseInline: [
      {
        name: nodeType,
        parse(cx, next, pos) {
          if (!firstCharCodes.includes(next)) {
            return -1;
          }
          const match = regex.exec(cx.slice(pos, cx.end));
          if (!match) {
            return -1;
          }
          return cx.addElement(cx.elt(nodeType, pos, pos + match[0].length));
        },
        // after: "Emphasis",
      },
    ],
  };
}

export function mdExtensionStyleTags({ nodeType, tag }: MDExt): {
  [selector: string]: Tag | readonly Tag[];
} {
  return {
    [nodeType]: tag,
  };
}

export function loadMarkdownExtensions(system: System<any>): MDExt[] {
  const mdExtensions: MDExt[] = [];
  for (const plug of system.loadedPlugs.values()) {
    const manifest = plug.manifest as Manifest;
    if (manifest.syntax) {
      for (const [nodeType, def] of Object.entries(manifest.syntax)) {
        mdExtensions.push(nodeDefToMDExt(nodeType, def));
      }
    }
  }
  return mdExtensions;
}

export function nodeDefToMDExt(nodeType: string, def: NodeDef): MDExt {
  return {
    nodeType,
    tag: Tag.define(),
    firstCharCodes: def.firstCharacters.map((ch) => ch.charCodeAt(0)),
    regex: new RegExp("^" + def.regex),
    styles: def.styles,
    className: def.className,
  };
}
