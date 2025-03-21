import type {
  IndexTreeEvent,
  ObjectValue,
} from "@silverbulletmd/silverbullet/types";
import { extractHashtag } from "@silverbulletmd/silverbullet/lib/tags";
import {
  collectNodesMatching,
  collectNodesOfType,
  type ParseTree,
} from "@silverbulletmd/silverbullet/lib/tree";
import { indexObjects } from "./api.ts";

type TableRowObject =
  & ObjectValue<{
    tableref: string;
    page: string;
    pos: number;
  }>
  & Record<string, any>;

/**
 * Replace any invalid characters in a string so it can serve as indexed field name in a query
 * @param str the input string
 * @returns All lowercase string with special chars replaced with underscore
 */
function cleanHeaderFieldName(str: string): string {
  return str.replace(/[\W_]+/g, "_").toLowerCase();
}

/**
 * Concat text properties of all child nodes
 * @param nodes
 * @returns
 */
function concatChildrenTexts(nodes: ParseTree[]): string {
  return nodes.map((c) => c.text).join("").trim();
}

export async function indexTables(event: IndexTreeEvent) {
  await indexObjects(event.name, extractObjects(event));
}

/**
 * Extract indexable objects for IndexTreeEvent.
 * This is the side-effect free part of `indexTables`
 */
export function extractObjects(
  { name: pageName, tree }: IndexTreeEvent,
): ObjectValue<TableRowObject>[] {
  const result: ObjectValue<TableRowObject>[] = [];

  collectNodesMatching(
    tree,
    (t) => !!t.type?.startsWith("Table") && t.type !== "TableConstructor",
  ).forEach(
    (table) => {
      const rows = collectNodesOfType(table, "TableRow");
      const header = collectNodesOfType(table, "TableHeader")[0]; //Use first header. As per markdown spec there can only be exactly one
      const headerLabels = collectNodesOfType(header, "TableCell").map((cell) =>
        concatChildrenTexts(cell.children!)
      ).map(cleanHeaderFieldName);
      //console.log("Header labels", headerLabels);

      for (const row of rows) {
        const tags = new Set<string>();
        collectNodesOfType(row, "Hashtag").forEach((h) => {
          // Push tag to the list, removing the initial #
          tags.add(extractHashtag(h.children![0].text!));
        });

        const tableRow: TableRowObject = {
          tableref: `${pageName}@${table.from}`,
          ref: `${pageName}@${row.from}`,
          tag: "table",
          tags: [...tags],
          page: pageName,
          pos: row.from!,
        };

        // Manually iterate through children to handle empty cells
        {
          let columnIndex = 0;
          for (
            let childIndex = 0;
            childIndex < row.children!.length &&
            columnIndex < headerLabels.length;
            childIndex++
          ) {
            // Go until the next column
            if (row.children![childIndex].type !== "TableDelimiter") continue;

            const next = row.children![childIndex + 1];
            // If the cell is empty TableDelimiter is followed by a text node, no TableCell
            if (next.type === "TableCell") {
              const content = concatChildrenTexts(next.children!);
              const label = headerLabels[columnIndex];
              tableRow[label!] = content;
            }
            columnIndex++;
          }
        }
        result.push(tableRow);
      }
    },
  );

  return result;
}
