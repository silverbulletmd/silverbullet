import { Tag } from "@lezer/highlight";
import type { MarkdownConfig } from "@lezer/markdown";
import { System } from "@plugos/plugos/system";
import { Manifest } from "@silverbulletmd/common/manifest";

export type MDExt = {
  // unicode char code for efficiency .charCodeAt(0)
  firstCharCodes: number[];
  regex: RegExp;
  nodeType: string;
  tag: Tag;
  styles: { [key: string]: string };
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
          let match = regex.exec(cx.slice(pos, cx.end));
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
  let mdExtensions: MDExt[] = [];
  for (let plug of system.loadedPlugs.values()) {
    let manifest = plug.manifest as Manifest;
    if (manifest.syntax) {
      for (let [nodeType, def] of Object.entries(manifest.syntax)) {
        mdExtensions.push({
          nodeType,
          tag: Tag.define(),
          firstCharCodes: def.firstCharacters.map((ch) => ch.charCodeAt(0)),
          regex: new RegExp("^" + def.regex),
          styles: def.styles,
          className: def.className,
        });
      }
    }
  }
  return mdExtensions;
}
