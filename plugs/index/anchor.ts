import {
  collectNodesOfType,
  type ParseTree,
  renderToText,
  replaceNodesMatching,
} from "@silverbulletmd/silverbullet/lib/tree";

const anchorNameRegex = /^[A-Za-z_][A-Za-z0-9_/:-]*$/;

export function isValidAnchorName(name: string): boolean {
  return anchorNameRegex.test(name);
}

export type CollectedAnchor = {
  name: string;
  from: number;
  to: number;
  // True when the host contained more than one NamedAnchor node.
  duplicateInHost: boolean;
};

/**
 * Returns the first NamedAnchor inside `n`, marking `duplicateInHost`
 * if more than one was present. Returns null if none.
 */
export function collectAnchor(n: ParseTree): CollectedAnchor | null {
  const nodes = collectNodesOfType(n, "NamedAnchor");
  if (nodes.length === 0) {
    return null;
  }
  const first = nodes[0];
  // The NamedAnchor's rendered text is the literal "$name". the leading
  // `$` lives in a NamedAnchorMark child node so live-preview can style
  // the sigil distinctly. We strip it here for the bare name.
  const literal = renderToText(first);
  const name = literal.slice(1);
  return {
    name,
    from: first.from!,
    to: first.to!,
    duplicateInHost: nodes.length > 1,
  };
}

/**
 * Strips NamedAnchor nodes from the (typically cloned) tree, mirroring
 * `cleanTags`. Mutates in place.
 */
export function cleanAnchor(n: ParseTree) {
  return replaceNodesMatching(n, (node) => {
    if (node.type === "NamedAnchor") {
      return null;
    }
    return;
  });
}
