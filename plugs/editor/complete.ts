import { CompleteEvent } from "$sb/app_event.ts";
import { space } from "$sb/syscalls.ts";
import { FileMeta, PageMeta } from "$sb/types.ts";
import { cacheFileListing } from "../federation/federation.ts";

// Completion
export async function pageComplete(completeEvent: CompleteEvent) {
  const match = /\[\[([^\]@$:\{}]*)$/.exec(completeEvent.linePrefix);
  if (!match) {
    return null;
  }
  let allPages: PageMeta[] = await space.listPages();
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
      return {
        label: pageMeta.name,
        boost: pageMeta.lastModified,
        type: "page",
      };
    }),
  };
}

function fileMetaToPageMeta(fileMeta: FileMeta): PageMeta {
  const name = fileMeta.name.substring(0, fileMeta.name.length - 3);
  return {
    ...fileMeta,
    ref: fileMeta.name,
    tags: ["page"],
    name,
    created: new Date(fileMeta.created).toISOString(),
    lastModified: new Date(fileMeta.lastModified).toISOString(),
  } as PageMeta;
}
