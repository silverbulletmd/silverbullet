import {SyntaxNode} from "@lezer/common";
import wikiMarkdownLang from "../webapp/parser";

export type MarkdownTree = {
  type?: string; // undefined === text node
  from?: number;
  to?: number;
  text?: string;
  children?: MarkdownTree[];
};

function treeToAST(text: string, n: SyntaxNode): MarkdownTree {
  let children: MarkdownTree[] = [];
  let nodeText: string | undefined;
  let child = n.firstChild;
  while (child) {
    children.push(treeToAST(text, child));
    child = child.nextSibling;
  }

  if (children.length === 0) {
    children = [
      {
        from: n.from,
        to: n.to,
        text: text.substring(n.from, n.to),
      },
    ];
  } else {
    let newChildren: MarkdownTree[] | string = [];
    let index = n.from;
    for (let child of children) {
      let s = text.substring(index, child.from);
      if (s) {
        newChildren.push({
          from: index,
          to: child.from,
          text: s,
        });
      }
      newChildren.push(child);
      index = child.to!;
    }
    let s = text.substring(index, n.to);
    if (s) {
      newChildren.push({ from: index, to: n.to, text: s });
    }
    children = newChildren;
  }

  let result: MarkdownTree = {
    type: n.name,
    from: n.from,
    to: n.to,
  };
  if (children.length > 0) {
    result.children = children;
  }
  if (nodeText) {
    result.text = nodeText;
  }
  return result;
}

export function parse(text: string): MarkdownTree {
  return treeToAST(text, wikiMarkdownLang.parser.parse(text).topNode);
}
