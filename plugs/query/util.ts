const maxWidth = 70;
// Nicely format an array of JSON objects as a Markdown table
export function jsonToMDTable(
  jsonArray: any[],
  valueTransformer: (k: string, v: any) => string = (k, v) => "" + v,
): string {
  const fieldWidths = new Map<string, number>();
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

  const headerList = [...fieldWidths.keys()];
  const lines = [];
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
