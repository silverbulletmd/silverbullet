import { CompleteEvent, FileMeta, PageMeta } from "../../plug-api/types.ts";
import { cacheFileListing } from "../federation/federation.ts";
import { queryObjects } from "../index/plug_api.ts";

// Completion
export async function pageComplete(completeEvent: CompleteEvent) {
  const match = /\[\[([^\]@$#:\{}]*)$/.exec(completeEvent.linePrefix);
  if (!match) {
    return null;
  }

  let allPages: PageMeta[] = [];

  if (
    completeEvent.parentNodes.find((node) => node.startsWith("FencedCode")) &&
    // either a render [[bla]] clause
    /(render\s+|template\()\[\[/.test(
      completeEvent.linePrefix,
    )
  ) {
    // We're in a template context, let's only complete templates
    allPages = await queryObjects<PageMeta>("template", {}, 5);
  } else if (
    completeEvent.parentNodes.find((node) =>
      node.startsWith("FencedCode:include") ||
      node.startsWith("FencedCode:template")
    )
  ) {
    // Include both pages and templates in page completion in ```include and ```template blocks
    allPages = await queryObjects<PageMeta>("page", {}, 5);
  } else {
    // Otherwise, just complete non-template pages
    allPages = await queryObjects<PageMeta>("page", {
      filter: ["!=", ["attr", "tags"], ["string", "template"]],
    }, 5);
  }

  const prefix = match[1];
  if (prefix.startsWith("!")) {
    // Federation prefix, let's first see if we're matching anything from federation that is locally synced
    const prefixMatches = allPages.filter((pageMeta) =>
      pageMeta.name.startsWith(prefix)
    );
    if (prefixMatches.length === 0) {
      // Ok, nothing synced in via federation, let's see if this URI is complete enough to try to fetch index.json
      if (prefix.includes("/")) {
        // Yep
        const domain = prefix.split("/")[0];
        // Cached listing
        const federationPages = (await cacheFileListing(domain)).filter((fm) =>
          fm.name.endsWith(".md")
        ).map(fileMetaToPageMeta);
        if (federationPages.length > 0) {
          allPages = allPages.concat(federationPages);
        }
      }
    }
  }
  return {
    from: completeEvent.pos - match[1].length,
    options: allPages.map((pageMeta) => {
      const completions: any[] = [];
      if (pageMeta.displayName) {
        completions.push({
          label: `${pageMeta.displayName}`,
          boost: new Date(pageMeta.lastModified).getTime(),
          apply: pageMeta.tag === "template"
            ? pageMeta.name
            : `${pageMeta.name}|${pageMeta.displayName}`,
          detail: `displayName for: ${pageMeta.name}`,
          type: "page",
        });
      }
      if (Array.isArray(pageMeta.aliases)) {
        for (const alias of pageMeta.aliases) {
          completions.push({
            label: `${alias}`,
            boost: new Date(pageMeta.lastModified).getTime(),
            apply: pageMeta.tag === "template"
              ? pageMeta.name
              : `${pageMeta.name}|${alias}`,
            detail: `alias to: ${pageMeta.name}`,
            type: "page",
          });
        }
      }
      completions.push({
        label: `${pageMeta.name}`,
        boost: new Date(pageMeta.lastModified).getTime(),
        type: "page",
      });
      return completions;
    }).flat(),
  };
}

function fileMetaToPageMeta(fileMeta: FileMeta): PageMeta {
  const name = fileMeta.name.substring(0, fileMeta.name.length - 3);
  return {
    ...fileMeta,
    ref: fileMeta.name,
    tag: "page",
    name,
    created: new Date(fileMeta.created).toISOString(),
    lastModified: new Date(fileMeta.lastModified).toISOString(),
  } as PageMeta;
}
