import {
  mdLinkRegex,
  wikiLinkRegex,
} from "../../client/markdown_parser/constants.ts";
import {
  encodeRef,
  getNameFromPath,
  parseToRef,
  type Path,
} from "@silverbulletmd/silverbullet/lib/ref";
import { unwrapLinkDestination } from "@silverbulletmd/silverbullet/lib/resolve";
import {
  type PathIndex,
  resolvePath,
} from "@silverbulletmd/silverbullet/lib/resolve_path";

export type LinkType = "wikilink" | "markdownlink";
/**
 * Represents a transclusion
 */
export type Transclusion = {
  url: string;
  alias: string;
  dimension?: ContentDimensions;
  linktype: LinkType;
};
/**
 * Describes the dimensions of a transclusion, if provided through the alias.
 * Can be parsed from the alias using {@link parseDimensionFromAlias}
 */
export type ContentDimensions = {
  width?: number | `${number}%`;
  height?: number;
};

/**
 * Parse an alias, possibly containing dimensions into an object
 * @example "alias", "alias|100", "alias|100x200", "100", "100x200", "30%", "alias|12.5%x200"
 */
export function parseDimensionFromAlias(text: string): {
  alias: string;
  dimension?: ContentDimensions;
} {
  let alias = text;
  let dimPart: string | undefined;
  let dim: ContentDimensions | undefined;
  if (text.includes("|")) {
    [alias, dimPart] = text.split("|");
  } else if (/^[x\d]|^\.\d+%/.test(text)) {
    dimPart = text;
    alias = "";
  }

  if (dimPart !== undefined) {
    const [width, height] = dimPart.split("x");
    dim = {};
    if (width) {
      if (width.includes("%")) {
        if (/^(?:\d+(?:\.\d+)?|\.\d+)%$/.test(width)) {
          dim.width = width as `${number}%`;
        }
      } else {
        dim.width = parseInt(width, 10);
      }
    }
    if (height && !height.includes("%")) {
      const pixels = parseInt(height, 10);
      if (!Number.isNaN(pixels)) dim.height = pixels;
    }
  }

  return { alias, dimension: dim };
}

/**
 * Parses a transclusion of the type `![[]]` or `![]()`
 * @param text
 */
export function parseTransclusion(text: string): Transclusion | null {
  let url, alias;
  let linktype: LinkType = "markdownlink";
  // TODO: Take in the tree and use tree nodes to get url and alias (Applies to all regex uses)
  mdLinkRegex.lastIndex = 0;
  wikiLinkRegex.lastIndex = 0;
  let match: RegExpMatchArray | null = null;
  if ((match = mdLinkRegex.exec(text)) && match.groups) {
    ({ url, title: alias } = match.groups);
    url = unwrapLinkDestination(url);

    linktype = "markdownlink";
  } else if ((match = wikiLinkRegex.exec(text)) && match.groups) {
    ({ stringRef: url, alias } = match.groups);
    linktype = "wikilink";
  } else {
    return null;
  }

  let dimension: ContentDimensions | undefined;
  if (alias) {
    ({ alias, dimension: dimension } = parseDimensionFromAlias(alias));
  } else {
    alias = "";
  }

  return {
    url,
    alias,
    dimension,
    linktype,
  };
}

/**
 * Rewrites a wiki-link transclusion's target to the path it resolves to, the
 * same way plain wiki links resolve.
 */
export function resolveTransclusionUrl(
  t: Transclusion,
  fromPage: Path,
  index: PathIndex,
): void {
  if (t.linktype !== "wikilink") {
    return;
  }
  const ref = parseToRef(t.url);
  if (!ref || ref.path === "") {
    return;
  }
  const resolution = resolvePath(ref.path, fromPage, index);
  if (resolution.exists && resolution.path !== ref.path) {
    t.url = encodeRef({ ...ref, path: resolution.path });
  }
}

export function nameFromTransclusion(t: Transclusion): string {
  const ref = parseToRef(t.url);
  if (!ref) {
    throw new Error(`Cannot extract name from transclusion: ${t.url}`);
  }
  return getNameFromPath(ref.path);
}
