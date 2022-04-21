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

// Nicely format an array of JSON objects as a Markdown table
export function jsonToMDTable(
  jsonArray: any[],
  valueTransformer?: (k: string, v: any) => string | undefined
): string {
  let headers = new Set<string>();
  for (let entry of jsonArray) {
    for (let k of Object.keys(entry)) {
      headers.add(k);
    }
  }
  let headerList = [...headers];
  let lines = [];
  lines.push("|" + headerList.join("|") + "|");
  lines.push("|" + headerList.map((title) => "----").join("|") + "|");
  for (const val of jsonArray) {
    let el = [];
    for (let prop of headerList) {
      el.push(valueTransformer ? valueTransformer(prop, val[prop]) : val[prop]);
    }
    lines.push("|" + el.join("|") + "|");
  }
  return lines.join("\n");
}
