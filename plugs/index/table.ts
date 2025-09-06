import type { IndexTreeEvent } from "../../type/event.ts";
import { renderToText, replaceNodesMatching } from "../../plug-api/lib/tree.ts";
import { extractHashtag } from "../../plug-api/lib/tags.ts";
import {
  collectNodesMatching,
  collectNodesOfType,
  type ParseTree,
} from "@silverbulletmd/silverbullet/lib/tree";
import { indexObjects } from "./api.ts";
import type { ObjectValue } from "../../type/index.ts";

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
 * @returns text of all child nodes
 */
function concatChildrenTexts(nodes: ParseTree[]): string {
  return nodes.map((c) => c.text).join("").trim();
}

/**
 * Concat text properties of all child nodes, preserving links
 * @param nodes
 * @returns text, preserving links, of all child nodes
 */
function concatChildrenTextsPreserveLinks(nodes: ParseTree[]): string {
  return nodes.map((c) => renderToText(c)).join("").trim();
}

export async function indexTables({ name: pageName, tree }: IndexTreeEvent) {
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

        const cells = collectNodesOfType(row, "TableCell");

        const tableRow: TableRowObject = {
          tableref: `${pageName}@${table.from}`,
          ref: `${pageName}@${row.from}`,
          tag: "table",
          tags: [...tags],
          page: pageName,
          pos: row.from!,
        };
        cells.forEach((c, i) => {
          replaceNodesMatching(c, (tree) => {
            if (tree.type === "Hashtag") {
              return null;
            }
          });
          const content = concatChildrenTextsPreserveLinks(c.children!);
          const label = headerLabels[i];
          tableRow[label!] = content;
        });
        result.push(tableRow);
      }
    },
  );

  await indexObjects(pageName, result);
}
