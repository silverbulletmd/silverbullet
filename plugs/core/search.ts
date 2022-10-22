import { fulltext } from "$sb/plugos-syscall/mod.ts";
import { renderToText } from "$sb/lib/tree.ts";
import type { FileMeta } from "../../common/types.ts";
import { editor, index } from "$sb/silverbullet-syscall/mod.ts";
import { IndexTreeEvent, QueryProviderEvent } from "$sb/app_event.ts";
import { applyQuery, removeQueries } from "$sb/lib/query.ts";
import {
  FileData,
  FileEncoding,
} from "../../common/spaces/space_primitives.ts";
import { base64EncodedDataUrl } from "../../plugos/asset_bundle/base64.ts";

const searchPrefix = "🔍 ";

export async function pageIndex(data: IndexTreeEvent) {
  removeQueries(data.tree);
  const cleanText = renderToText(data.tree);
  await fulltext.fullTextIndex(data.name, cleanText);
}

export async function pageUnindex(pageName: string) {
  await fulltext.fullTextDelete(pageName);
}

export async function queryProvider({
  query,
}: QueryProviderEvent): Promise<any[]> {
  const phraseFilter = query.filter.find((f) => f.prop === "phrase");
  if (!phraseFilter) {
    throw Error("No 'phrase' filter specified, this is mandatory");
  }
  let results = await fulltext.fullTextSearch(phraseFilter.value, {
    highlightEllipsis: "...",
    limit: 100,
  });

  const allPageMap: Map<string, any> = new Map(
    results.map((r: any) => [r.name, r]),
  );
  for (const { page, value } of await index.queryPrefix("meta:")) {
    const p = allPageMap.get(page);
    if (p) {
      for (const [k, v] of Object.entries(value)) {
        p[k] = v;
      }
    }
  }

  // Remove the "phrase" filter
  query.filter.splice(query.filter.indexOf(phraseFilter), 1);

  results = applyQuery(query, results);
  return results;
}

export async function searchCommand() {
  const phrase = await editor.prompt("Search for: ");
  if (phrase) {
    await editor.navigate(`${searchPrefix}${phrase}`);
  }
}

export async function readFileSearch(
  name: string,
  encoding: FileEncoding,
): Promise<{ data: FileData; meta: FileMeta }> {
  const phrase = name.substring(
    searchPrefix.length,
    name.length - ".md".length,
  );
  console.log("Here");
  const results = await fulltext.fullTextSearch(phrase, {
    highlightEllipsis: "...",
    highlightPostfix: "==",
    highlightPrefix: "==",
    summaryMaxLength: 30,
    limit: 100,
  });
  const text = `# Search results for "${phrase}"\n${
    results
      .map((r: any) =>
        `[[${r.name}]]:\n> ${r.snippet.split("\n").join("\n> ")}`
      )
      .join("\n\n")
  }
  `;

  return {
    // encoding === "arraybuffer" is not an option, so either it's "string" or "dataurl"
    data: encoding === "string" ? text : base64EncodedDataUrl(
      "text/markdown",
      new TextEncoder().encode(text),
    ),
    meta: {
      name,
      contentType: "text/markdown",
      size: text.length,
      lastModified: 0,
      perm: "ro",
    },
  };
}

export function getFileMetaSearch(name: string): FileMeta {
  return {
    name,
    contentType: "text/markdown",
    size: -1,
    lastModified: 0,
    perm: "ro",
  };
}
