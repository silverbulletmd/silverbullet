import { SyntaxNode } from "@lezer/common";
import wikiMarkdownLang from "../webapp/parser";

export type MarkdownTree = {
  type?: string; // undefined === text node
  from?: number;
  to?: number;
  text?: string;
  children?: MarkdownTree[];
};

function treeToAST(text: string, n: SyntaxNode, offset = 0): MarkdownTree {
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
        from: n.from + offset,
        to: n.to + offset,
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
          from: index + offset,
          to: child.from! + offset,
          text: s,
        });
      }
      newChildren.push(child);
      index = child.to!;
    }
    let s = text.substring(index, n.to);
    if (s) {
      newChildren.push({ from: index + offset, to: n.to + offset, text: s });
    }
    children = newChildren;
  }

  let result: MarkdownTree = {
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

export function parse(text: string): MarkdownTree {
  let tree = treeToAST(text, wikiMarkdownLang.parser.parse(text).topNode);
  // replaceNodesMatching(tree, (n): MarkdownTree | undefined | null => {
  //   if (n.type === "FencedCode") {
  //     let infoN = findNodeMatching(n, (n) => n.type === "CodeInfo");
  //     let language = infoN!.children![0].text;
  //     let textN = findNodeMatching(n, (n) => n.type === "CodeText");
  //     let text = textN!.children![0].text!;
  //
  //     console.log(language, text);
  //     switch (language) {
  //       case "yaml":
  //         let parsed = StreamLanguage.define(yaml).parser.parse(text);
  //         let subTree = treeToAST(text, parsed.topNode, n.from);
  //         // console.log(JSON.stringify(subTree, null, 2));
  //         subTree.type = "yaml";
  //         return subTree;
  //     }
  //   }
  //   return;
  // });
  return tree;
}
