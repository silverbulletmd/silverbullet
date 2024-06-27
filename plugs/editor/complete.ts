import {
  AttachmentMeta,
  CompleteEvent,
  FileMeta,
  PageMeta,
} from "$sb/types.ts";
import { listFilesCached } from "../federation/federation.ts";
import { queryObjects } from "../index/plug_api.ts";
import { folderName } from "$sb/lib/resolve.ts";
import { readSetting } from "$sb/lib/settings_page.ts";
import { editor } from "$sb/syscalls.ts"
import type { Decoration } from "$lib/web.ts";

let decorations: Decoration[] = [];

// Completion
export async function pageComplete(completeEvent: CompleteEvent) {
  try {
    await updateDecoratorConfig();
  } catch (err: any) {
    await editor.flashNotification(err.message, "error");
  }

  // Try to match [[wikilink]]
  let isWikilink = true;
  let match = /\[\[([^\]@$#:\{}]*)$/.exec(completeEvent.linePrefix);
  if (!match) {
    // Try to match [markdown link]()
    match = /\[.*\]\(([^\]\)@$#:\{}]*)$/.exec(completeEvent.linePrefix);
    isWikilink = false;
  }
  if (!match) {
    return null;
  }

  let allPages: (PageMeta | AttachmentMeta)[] = [];

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
    // Include both pages and meta in page completion in ```include and ```template blocks
    allPages = await queryObjects<PageMeta>("page", {}, 5);
  } else {
    // Otherwise, just complete non-meta pages
    allPages = await queryObjects<PageMeta>("page", {
      filter: ["and", ["!=", ["attr", "tags"], ["string", "template"]], ["!=", [
        "attr",
        "tags",
      ], ["string", "meta"]]],
    }, 5);
    // and attachments
    allPages = allPages.concat(
      await queryObjects<AttachmentMeta>("attachment", {}, 5),
    );
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
        const federationPages = (await listFilesCached(domain)).filter((fm) =>
          fm.name.endsWith(".md")
        ).map(fileMetaToPageMeta);
        if (federationPages.length > 0) {
          allPages = allPages.concat(federationPages);
        }
      }
    }
  }

  const folder = folderName(completeEvent.pageName);
  return {
    from: completeEvent.pos - match[1].length,
    options: allPages.map((pageMeta) => {
      const completions: any[] = [];
      let namePrefix = "";
      const decor = decorations.find(d => pageMeta.tags?.some((t: any) => d.tag === t));
      if (decor) {
        namePrefix = decor.prefix;
      }
      if (isWikilink) {
        if (pageMeta.displayName) {
          const decoratedName = namePrefix + pageMeta.displayName;
          completions.push({
            label: `${pageMeta.displayName}`,
            displayLabel: decoratedName,
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
            const decoratedName = namePrefix + alias;
            completions.push({
              label: `${alias}`,
              displayLabel: decoratedName,
              boost: new Date(pageMeta.lastModified).getTime(),
              apply: pageMeta.tag === "template"
                ? pageMeta.name
                : `${pageMeta.name}|${alias}`,
              detail: `alias to: ${pageMeta.name}`,
              type: "page",
            });
          }
        }
        const decoratedName = namePrefix + pageMeta.name;
        completions.push({
          label: `${pageMeta.name}`,
          displayLabel: decoratedName,
          boost: new Date(pageMeta.lastModified).getTime(),
          type: "page",
        });
      } else {
        let labelText = pageMeta.name;
        let boost = new Date(pageMeta.lastModified).getTime();
        // Relative path if in the same folder or a subfolder
        if (folder.length > 0 && labelText.startsWith(folder)) {
          labelText = labelText.slice(folder.length + 1);
          boost = boost * 1.1;
        } else {
          // Absolute path otherwise
          labelText = "/" + labelText;
        }
        completions.push({
          label: labelText,
          boost: boost,
          apply: labelText.includes(" ") ? "<" + labelText + ">" : labelText,
          type: "page",
        });
      }
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

let lastConfigUpdate = 0;

async function updateDecoratorConfig() {
  // Update at most every 5 seconds
  if (Date.now() < lastConfigUpdate + 5000) return;
  lastConfigUpdate = Date.now();
  const decoratorConfig = await readSetting("decorations");
  if (!decoratorConfig) {
    return;
  }

  decorations = decoratorConfig;
}
