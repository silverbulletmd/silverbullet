import type { ParseTree } from "@silverbulletmd/silverbullet/lib/tree";
import type { Tag } from "./html_render.ts";

/** How to justify a table's row's cells */
type Justification = "" | "left" | "right" | "center";

export function justifiedTableRender(
  cleaned_table: Tag[],
  parse_tree: ParseTree,
): Tag[] {
  const justify: Justification[] = getTableJustification(parse_tree);
  return justifedTableTags(cleaned_table, justify);
}

/** Takes a markdown table's `ParseTree` and returns how the table delimiter requests the table be justified
 * @argument t ParseTree - A markdown table's `ParseTree`
 */
function getTableJustification(t: ParseTree): Justification[] {
  const justify: Justification[] = [];
  // Get the delimiter line
  const delimiter = t.children?.find((child) => {
    return child.type == "TableDelimiter";
  });
  // Split at "|"
  delimiter?.children?.at(0)?.text?.split("|").map((split) => {
    if (split == "") return; // If empty - ignore
    const left = split.slice(0, 1) == ":"; // do we start with ':'?
    const right = split.slice(-1) == ":"; // do we end with ':'?
    if (left && right) justify.push("center");
    // both = center!
    else if (left) justify.push("left");
    // left = left!
    else if (right) justify.push("right");
    // right = right!
    else justify.push(""); // nothing = do nothing!
  });
  return justify;
}

function justifyRow(row: Tag, justify: Justification[]): Tag[] | void {
  if (typeof row == "string") return;
  if (typeof row.body == "string") return;
  let i = 0; // not doing a for (i i< i++) because typescript's type checking gets annoyed
  // for each cell in the row...
  return row.body.map((cell) => {
    if (justify[i] == "") return cell; // do nothing
    if (typeof cell == "string") return cell; // also do nothing
    // Make sure the Tag has an attrs
    if (typeof cell.attrs == "undefined") cell.attrs = {};
    // Make sure the Tag's attrs has a style
    if (typeof cell.attrs.style == "undefined") cell.attrs.style = "";
    switch (justify[i]) {
      case "center":
        cell.attrs.style += "text-align: center; ";
        break;
      case "left":
        cell.attrs.style += "text-align: left; ";
        break;
      case "right":
        cell.attrs.style += "text-align: right; ";
        break;
      case "":
      default:
    }
    i += 1; // increment i
    return cell;
  });
}

/** Takes a table body and justifications to apply and applies the justifications
 * @argument table_body Tag[] - The pre-rendered table body as seen in `render()`
 * @argument justify string[] - A string per table column saying how it should be justified
 * @author ProbablySophie
 */
function justifedTableTags(table_body: Tag[], justify: Justification[]): Tag[] {
  // For each row
  return table_body.map((row: Tag) => {
    // If the row is just a string or the row's body is a string, ignore it
    if (typeof row == "string") return row;
    let new_body;
    // The table head needs a special case
    if (row.name == "thead") {
      if (typeof row.body == "string") return row;
      new_body = justifyRow(row.body[0], justify);
    } else {
      new_body = justifyRow(row, justify);
    }
    // Make sure we didn't get null
    if (new_body == null) return row;
    // Else
    if (row.name == "thead") {
      if (typeof row.body == "string") return row;
      if (typeof row.body[0] == "string") return row;

      row.body[0].body = new_body;
    } else {
      row.body = new_body;
    }
    return row;
  });
}
