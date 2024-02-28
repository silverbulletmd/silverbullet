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
    children.push(lezerToParseTree(text, child));
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
    let index = n.from;
    for (const child of children) {
      const s = text.substring(index, child.from);
      if (s) {
        newChildren.push({
          from: index + offset,
          to: child.from! + offset,
          text: s,
        });
      }
      newChildren.push(child);
      index = child.to!;
    }
    const s = text.substring(index, n.to);
    if (s) {
      newChildren.push({ from: index + offset, to: n.to + offset, text: s });
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

export function parse(language: Language, text: string): ParseTree {
  // Remove \r for Windows before parsing
  text = text.replaceAll("\r", "");
  const tree = lezerToParseTree(text, language.parser.parse(text).topNode);
  return tree;
}
