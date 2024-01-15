import { CompleteEvent } from "$sb/app_event.ts";
import { FileMeta, PageMeta } from "$sb/types.ts";
import { cacheFileListing } from "../federation/federation.ts";
import { queryObjects } from "../index/plug_api.ts";

// Completion
export async function pageComplete(completeEvent: CompleteEvent) {
  const match = /\[\[([^\]@$:\{}]*)$/.exec(completeEvent.linePrefix);
  if (!match) {
    return null;
  }
  // When we're in fenced code block, we likely want to complete a page name without an alias, and only complete template pages
  // so let's check if we're in a template context
  const isInTemplateContext =
    completeEvent.parentNodes.find((node) => node.startsWith("FencedCode")) &&
    // either a render [[bla]] clause or page: "[[bla]]" template block
    /render\s+\[\[|page:\s*["']\[\[/.test(
      completeEvent.linePrefix,
    );
  const tagToQuery = isInTemplateContext ? "template" : "page";
  let allPages: PageMeta[] = await queryObjects<PageMeta>(tagToQuery, {}, 5);
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
          apply: isInTemplateContext
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
            apply: isInTemplateContext
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
