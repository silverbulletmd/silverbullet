import {
  addParentPointers,
  collectNodesMatching,
  ParseTree,
  renderToText,
} from "../../common/tree.ts";

export const queryRegex =
  /(<!--\s*#query\s+(.+?)-->)(.+?)(<!--\s*\/query\s*-->)/gs;

export const directiveStartRegex = /<!--\s*#([\w\-]+)\s+(.+?)-->/s;

export const directiveEndRegex = /<!--\s*\/([\w\-]+)\s*-->/s;

export function removeQueries(pt: ParseTree) {
  addParentPointers(pt);
  collectNodesMatching(pt, (t) => {
    if (t.type !== "CommentBlock") {
      return false;
    }
    let text = t.children![0].text!;
    let match = directiveStartRegex.exec(text);
    if (!match) {
      return false;
    }
    let directiveType = match[1];
    let parentChildren = t.parent!.children!;
    let index = parentChildren.indexOf(t);
    let nodesToReplace: ParseTree[] = [];
    for (let i = index + 1; i < parentChildren.length; i++) {
      let n = parentChildren[i];
      if (n.type === "CommentBlock") {
        let text = n.children![0].text!;
        let match = directiveEndRegex.exec(text);
        if (match && match[1] === directiveType) {
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

const maxWidth = 70;
// Nicely format an array of JSON objects as a Markdown table
export function jsonToMDTable(
  jsonArray: any[],
  valueTransformer: (k: string, v: any) => string = (k, v) => "" + v,
): string {
  let fieldWidths = new Map<string, number>();
  for (let entry of jsonArray) {
    for (let k of Object.keys(entry)) {
      let fieldWidth = fieldWidths.get(k);
      if (!fieldWidth) {
        fieldWidth = valueTransformer(k, entry[k]).length;
      } else {
        fieldWidth = Math.max(valueTransformer(k, entry[k]).length, fieldWidth);
      }
      fieldWidths.set(k, fieldWidth);
    }
  }

  let fullWidth = 0;
  for (let v of fieldWidths.values()) {
    fullWidth += v + 1;
  }

  let headerList = [...fieldWidths.keys()];
  let lines = [];
  lines.push(
    "|" +
      headerList
        .map(
          (headerName) =>
            headerName +
            charPad(" ", fieldWidths.get(headerName)! - headerName.length),
        )
        .join("|") +
      "|",
  );
  lines.push(
    "|" +
      headerList
        .map((title) => charPad("-", fieldWidths.get(title)!))
        .join("|") +
      "|",
  );
  for (const val of jsonArray) {
    let el = [];
    for (let prop of headerList) {
      let s = valueTransformer(prop, val[prop]);
      el.push(s + charPad(" ", fieldWidths.get(prop)! - s.length));
    }
    lines.push("|" + el.join("|") + "|");
  }
  return lines.join("\n");

  function charPad(ch: string, length: number) {
    if (fullWidth > maxWidth && ch === "") {
      return "";
    } else if (fullWidth > maxWidth && ch === "-") {
      return "--";
    }
    if (length < 1) {
      return "";
    }
    return new Array(length + 1).join(ch);
  }
}
