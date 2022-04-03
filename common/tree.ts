import {SyntaxNode} from "@lezer/common";
import wikiMarkdownLang from "../webapp/parser";

export type MarkdownTree = {
    type?: string; // undefined === text node
    from: number;
    to: number;
    text?: string;
    children?: MarkdownTree[];
    parent?: MarkdownTree;
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
            index = child.to;
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

// Currently unused
function addParentPointers(mdTree: MarkdownTree) {
    if (!mdTree.children) {
        return;
    }
    for (let child of mdTree.children) {
        child.parent = mdTree;
        addParentPointers(child);
    }
}

// Finds non-text node at position
export function nodeAtPos(
    mdTree: MarkdownTree,
    pos: number
): MarkdownTree | null {
    if (pos < mdTree.from || pos > mdTree.to) {
        return null;
    }
    if (!mdTree.children) {
        return mdTree;
    }
    for (let child of mdTree.children) {
        let n = nodeAtPos(child, pos);
        if (n && n.text) {
            // Got a text node, let's return its parent
            return mdTree;
        } else if (n) {
            // Got it
            return n;
        }
    }
    return null;
}

// Turn MarkdownTree back into regular markdown text
export function render(mdTree: MarkdownTree): string {
    let pieces: string[] = [];
    if (mdTree.text) {
        return mdTree.text;
    }
    for (let child of mdTree.children!) {
        pieces.push(render(child));
    }
    return pieces.join("");
}

export function parse(text: string): MarkdownTree {
    return treeToAST(text, wikiMarkdownLang.parser.parse(text).topNode);
}
