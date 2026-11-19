import type { SyntaxNode } from "@lezer/common";

// ParseTree nodes match this shape
type LinkChild = { type?: string; from?: number; to?: number };
type NodeSpan = { type: string; from: number; to: number };

export type MarkdownLinkParts<T extends LinkChild> = {
  /** Where the link text between `[` (or `![`) and `]` starts */
  textFrom: number;
  /** Where the link text ends */
  textTo: number;
  /** Where the part between `(` and `)`, the url and any title, starts */
  destinationFrom: number;
  /** Where the part between `(` and `)` ends */
  destinationTo: number;
  /** The url, without any title */
  url: T;
};

/**
 * Splits a `Link` or `Image` node into its parts using only its direct
 * children, so an image nested in a link (`[![alt](img.png)](doc.pdf)`)
 * neither ends the link text nor lends the link its URL.
 * @param children - the node's direct children
 * @returns null for a link without a url (`[text]()`, `[text][ref]`)
 */
export function markdownLinkParts<T extends LinkChild>(
  children: T[],
): MarkdownLinkParts<T> | null {
  // Brackets inside the link text belong to nested nodes, so the direct
  // marks are the link's own `[`, `]`, `(` and `)`
  const marks = children.filter((c) => c.type === "LinkMark");
  const url = children.find((c) => c.type === "URL");
  if (marks.length < 4 || !url) {
    return null;
  }
  const [open, close, paren] = marks;
  return {
    textFrom: open.to!,
    textTo: close.from!,
    destinationFrom: paren.to!,
    destinationTo: marks[marks.length - 1].from!,
    url,
  };
}

/** The children within `from`..`to`, such as those of a link's text */
export function childrenWithin<T extends LinkChild>(
  children: T[],
  from: number,
  to: number,
): T[] {
  return children.filter((c) => c.from! >= from && c.to! <= to);
}

/** {@link markdownLinkParts} for a `Link` or `Image` node of a Lezer tree */
export function markdownLinkPartsOfNode(
  node: SyntaxNode,
): MarkdownLinkParts<NodeSpan> | null {
  const children: NodeSpan[] = [];
  for (let c = node.firstChild; c; c = c.nextSibling) {
    children.push({ type: c.name, from: c.from, to: c.to });
  }
  return markdownLinkParts(children);
}
