import { addParentPointers, collectNodesMatching, ParseTree, renderToText } from "../../common/tree";

export const queryRegex =
  /(<!--\s*#query\s+(.+?)-->)(.+?)(<!--\s*#end\s*-->)/gs;

export const queryStartRegex = /<!--\s*#query\s+(.+?)-->/s;

export const queryEndRegex = /<!--\s*#end\s*-->/s;

// export function whiteOutQueries(text: string): string {
//   return text.replaceAll(queryRegex, (match) =>
//     new Array(match.length + 1).join(" ")
//   );
// }

export function removeQueries(pt: ParseTree) {
  addParentPointers(pt);
  collectNodesMatching(pt, (t) => {
    if (t.type !== "CommentBlock") {
      return false;
    }
    let text = t.children![0].text!;
    if (!queryStartRegex.exec(text)) {
      return false;
    }
    let parentChildren = t.parent!.children!;
    let index = parentChildren.indexOf(t);
    let nodesToReplace: ParseTree[] = [];
    for (let i = index + 1; i < parentChildren.length; i++) {
      let n = parentChildren[i];
      if (n.type === "CommentBlock") {
        let text = n.children![0].text!;
        if (queryEndRegex.exec(text)) {
          break;
        }
      }
      nodesToReplace.push(n);
    }
    let renderedText = nodesToReplace.map(renderToText).join("");
    parentChildren.splice(index + 1, nodesToReplace.length, {
      text: new Array(renderedText.length + 1).join(" "),
    });
    return true;
  });
}
