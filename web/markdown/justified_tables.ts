import type { ParseTree } from "@silverbulletmd/silverbullet/lib/tree";
import type { Tag } from "./html_render.ts";

/** How to justify a table's row's cells */
type Justification = "" | "left" | "right" | "center";

export function justifiedTableRender(
  cleaned_table: Tag[],
  parse_tree: ParseTree,
): Tag[] {
  const justify: Justification[] = getTableJustification(parse_tree);
  return justifiedTableTags(cleaned_table, justify);
}

/** Takes a markdown table's `ParseTree` and returns how the table delimiter requests the table be justified
 * @argument t ParseTree - A markdown table's `ParseTree`
 */
function getTableJustification(t: ParseTree): Justification[] {
  const delimiter = t.children?.find((child) =>
    child.type === "TableDelimiter"
  );
  const delimiterText = delimiter?.children?.at(0)?.text;

  if (!delimiterText) return [];

  // Split at "|" and filter out empty strings (from leading/trailing |)
  const columnDelimiters = delimiterText.split("|").filter((part) =>
    part.trim() !== ""
  );

  return columnDelimiters.map(parseColumnAlignment);
}

/** Parse a single column delimiter to determine its alignment */
function parseColumnAlignment(delimiter: string): Justification {
  const trimmed = delimiter.trim();

  if (trimmed === "") return "";

  const left = trimmed.startsWith(":");
  const right = trimmed.endsWith(":");

  if (left && right) return "center";
  if (left) return "left";
  if (right) return "right";
  return "";
}

type TagObject = {
  name: string;
  attrs?: Record<string, string | undefined>;
  body: Tag[] | string;
};

/** Type guard to check if a value is a non-string Tag */
function isTagObject(value: Tag): value is TagObject {
  return typeof value !== "string";
}

/** Type guard to check if a Tag has a body array */
function hasBodyArray(tag: TagObject): tag is TagObject & { body: Tag[] } {
  return Array.isArray(tag.body);
}

/** Apply justification to a single row */
function justifyRow(row: TagObject, justify: Justification[]): Tag[] {
  if (!hasBodyArray(row)) {
    return [];
  }

  return row.body.map((cell, i) => {
    const alignment = justify[i];

    // Skip if no alignment specified or if cell is a string
    if (!alignment || !isTagObject(cell)) {
      return cell;
    }

    // Ensure cell has attrs object
    if (!cell.attrs) {
      cell.attrs = {};
    }

    // Add alignment class
    const alignmentClass = `sb-table-align-${alignment}`;
    if (cell.attrs.class) {
      cell.attrs.class += ` ${alignmentClass}`;
    } else {
      cell.attrs.class = alignmentClass;
    }

    return cell;
  });
}

/** Takes a table body and justifications to apply and applies the justifications
 * @argument table_body Tag[] - The pre-rendered table body as seen in `render()`
 * @argument justify Justification[] - A justification per table column
 */
function justifiedTableTags(
  table_body: Tag[],
  justify: Justification[],
): Tag[] {
  if (justify.length === 0) return table_body;

  return table_body.map((row: Tag) => {
    if (!isTagObject(row)) return row;

    // Handle thead specially - it contains a tr row
    if (row.name === "thead" && hasBodyArray(row)) {
      const trRow = row.body[0];
      if (isTagObject(trRow)) {
        const newBody = justifyRow(trRow, justify);
        trRow.body = newBody;
      }
    } else {
      // Handle regular rows
      const newBody = justifyRow(row, justify);
      if (newBody.length > 0) {
        row.body = newBody;
      }
    }

    return row;
  });
}
