import type { ParseTree } from "../../plug-api/lib/tree.ts";
import type { SyntaxNode } from "@lezer/common";
import type { Language } from "@codemirror/language";

export function lezerToParseTree(
  text: string,
  n: SyntaxNode,
  offset = 0,
): ParseTree {
  let children: ParseTree[] = [];
  let nodeText: string | undefined;
  let child = n.firstChild;
  while (child) {
    children.push(lezerToParseTree(text, child, offset));
    child = child.nextSibling;
  }

  if (children.length === 0) {
    children = [
      {
        from: n.from + offset,
        to: n.to + offset,
        text: text.substring(n.from, n.to),
      },
    ];
  } else {
    const newChildren: ParseTree[] = [];
    let startIndex = n.from + offset;
    for (const child of children) {
      // indices are shifted with offset, so first need to shift back to get text
      const s = text.substring(startIndex - offset, child.from! - offset);
      if (s) {
        newChildren.push({
          from: startIndex,
          to: child.from!,
          text: s,
        });
      }
      newChildren.push(child);
      startIndex = child.to!;
    }
    const s = text.substring(startIndex - offset, n.to);
    if (s) {
      newChildren.push({
        from: startIndex,
        to: n.to + offset,
        text: s,
      });
    }
    children = newChildren;
  }

  const result: ParseTree = {
    type: n.name,
    from: n.from + offset,
    to: n.to + offset,
  };
  if (children.length > 0) {
    result.children = children;
  }
  if (nodeText) {
    result.text = nodeText;
  }
  return result;
}

export function parse(
  language: Language,
  text: string,
  offset?: number,
): ParseTree {
  // Remove \r for Windows before parsing
  text = text.replaceAll("\r", "");
  const tree = lezerToParseTree(
    text,
    language.parser.parse(text).topNode,
    offset,
  );
  return tree;
}
