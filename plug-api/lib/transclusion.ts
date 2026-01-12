import {
  isLocalURL,
  resolveMarkdownLink,
} from "@silverbulletmd/silverbullet/lib/resolve";
import {
  mdLinkRegex,
  wikiLinkRegex,
} from "../../client/markdown_parser/constants.ts";
import {
  getNameFromPath,
  parseToRef,
} from "@silverbulletmd/silverbullet/lib/ref";

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
  width?: number;
  height?: number;
};

/**
 * Parse an alias, possibly containing dimensions into an object
 * @example "alias", "alias|100", "alias|100x200", "100", "100x200"
 */
export function parseDimensionFromAlias(
  text: string,
): { alias: string; dimension?: ContentDimensions } {
  let alias: string;
  let dim: ContentDimensions | undefined;
  if (text.includes("|")) {
    const [aliasPart, dimPart] = text.split("|");
    alias = aliasPart;
    const [width, height] = dimPart.split("x");
    dim = {};
    if (width) {
      dim.width = parseInt(width);
    }
    if (height) {
      dim.height = parseInt(height);
    }
  } else if (/^[x\d]/.test(text)) {
    const [width, height] = text.split("x");
    dim = {};
    if (width) {
      dim.width = parseInt(width);
    }
    if (height) {
      dim.height = parseInt(height);
    }
    alias = "";
  } else {
    alias = text;
  }

  return { alias, dimension: dim };
}

/**
 * Parses a transclusion of the type `![[]]` or `![]()`
 * @param text
 */
export function parseTransclusion(
  text: string,
): Transclusion | null {
  let url, alias = undefined;
  let linktype: LinkType = "markdownlink";
  // TODO: Take in the tree and use tree nodes to get url and alias (Applies to all regex uses)
  mdLinkRegex.lastIndex = 0;
  wikiLinkRegex.lastIndex = 0;
  let match: RegExpMatchArray | null = null;
  if ((match = mdLinkRegex.exec(text)) && match.groups) {
    ({ url, title: alias } = match.groups);

    if (isLocalURL(url)) {
      url = resolveMarkdownLink(
        client.currentName(),
        decodeURI(url),
      );
    }
    linktype = "markdownlink";
  } else if ((match = wikiLinkRegex.exec(text)) && match.groups) {
    ({ stringRef: url, alias } = match.groups);
    linktype = "wikilink";
  } else {
    // We found no match
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

export function nameFromTransclusion(t: Transclusion): string {
  const ref = parseToRef(t.url);
  if (!ref) {
    throw new Error(`Cannot extract name from transclusion: ${t.url}`);
  }
  return getNameFromPath(ref.path);
}
