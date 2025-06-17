import { folderName } from "@silverbulletmd/silverbullet/lib/resolve";
import { queryLuaObjects } from "../index/api.ts";
import { language, lua } from "@silverbulletmd/silverbullet/syscalls";
import type { DocumentMeta, PageMeta } from "../../type/index.ts";
import type { CompleteEvent } from "@silverbulletmd/silverbullet/type/client";

// Page completion
export async function pageComplete(completeEvent: CompleteEvent) {
  const isDocumentQuery = {
    objectVariable: "_",
    where: await lua.parseExpression(`not string.startsWith(_.name, "_")`),
  };
  const isMetaPageQuery = {
    objectVariable: "_",
    where: await lua.parseExpression(`table.find(_.tags, function(tag)
           return string.startsWith(tag, "meta")
          end)`),
  };
  const isntMetaPageQuery = {
    objectVariable: "_",
    where: await lua.parseExpression(`not table.find(_.tags, function(tag)
           return string.startsWith(tag, "meta")
          end)`),
  };
  // Try to match [[wikilink]]
  let isWikilink = true;
  // This negative lookbehind is to prevent matching query[[. This requires negative lookbehind, which generally supported now (it seems), in versions of iOS Safari 13.1 and later
  // https://caniuse.com/js-regexp-lookbehind
  let match = /(?<!query)\[\[([^\]@$#:\{}]*)$/.exec(completeEvent.linePrefix);
  if (!match) {
    // Try to match [markdown link]()
    match = /\[.*\]\(([^\]\)@$#:\{}]*)$/.exec(completeEvent.linePrefix);
    isWikilink = false;
  }
  if (!match) {
    return null;
  }

  const prefix = match[1];

  let allPages: (PageMeta | DocumentMeta)[] = [];

  if (prefix.startsWith("^")) {
    // A carrot prefix means we're looking for a meta page
    allPages = await queryLuaObjects<PageMeta>("page", isMetaPageQuery!, {}, 5);
    // Let's prefix the names with a caret to make them match
    allPages = allPages.map((page) => ({
      ...page,
      name: "^" + page.name,
    }));
  } else {
    // This is the most common case, we're combining three types of completions here:
    allPages = (await Promise.all([
      // All non-meta pages
      queryLuaObjects<PageMeta>("page", isntMetaPageQuery!, {}, 5),
      // All documents
      queryLuaObjects<DocumentMeta>("document", isDocumentQuery!, {}, 5),
      // And all links to non-existing pages (to augment the existing ones)
      queryLuaObjects<string>(
        "aspiring-page",
        {
          select: { type: "Variable", name: "name", ctx: {} as any },
          distinct: true,
        },
        {},
        5,
      ).then((aspiringPages) =>
        // Rewrite them to PageMeta shaped objects
        aspiringPages.map((aspiringPage: string): PageMeta => ({
          ref: aspiringPage,
          tag: "page",
          tags: ["non-existing"], // Picked up later in completion
          name: aspiringPage,
          created: "",
          lastModified: "",
          perm: "rw",
        }))
      ),
    ])).flat();
  }

  // Don't complete hidden pages
  allPages = allPages.filter((page) => !(page.pageDecoration?.hide === true));

  const folder = folderName(completeEvent.pageName);

  return {
    from: completeEvent.pos - prefix.length,
    options: allPages.map((pageMeta) => {
      const completions: any[] = [];
      const namePrefix = (pageMeta as PageMeta).pageDecoration?.prefix || "";
      const cssClass = ((pageMeta as PageMeta).pageDecoration?.cssClasses || [])
        .join(" ").replaceAll(/[^a-zA-Z0-9-_ ]/g, "");

      if (isWikilink) {
        // A [[wikilink]]
        if (pageMeta.displayName) {
          const decoratedName = namePrefix + pageMeta.displayName;
          let boost = new Date(pageMeta.lastModified).getTime();
          if (pageMeta._isAspiring) {
            boost = -Infinity;
          }
          completions.push({
            label: pageMeta.displayName,
            displayLabel: decoratedName,
            boost,
            apply: pageMeta.tag === "template"
              ? pageMeta.name
              : `${pageMeta.name}|${pageMeta.displayName}`,
            detail: `displayName for: ${pageMeta.name}`,
            type: "page",
            cssClass,
          });
        }
        if (Array.isArray(pageMeta.aliases)) {
          for (const alias of pageMeta.aliases) {
            const decoratedName = namePrefix + alias;
            completions.push({
              label: alias,
              displayLabel: decoratedName,
              boost: new Date(pageMeta.lastModified).getTime(),
              apply: pageMeta.tag === "template"
                ? pageMeta.name
                : `${pageMeta.name}|${alias}`,
              detail: `alias to: ${pageMeta.name}`,
              type: "page",
              cssClass,
            });
          }
        }
        const decoratedName = namePrefix + pageMeta.name;
        completions.push({
          label: pageMeta.name,
          displayLabel: decoratedName,
          boost: new Date(pageMeta.lastModified).getTime(),
          detail: pageMeta.tags?.includes("non-existing")
            ? "Linked but not created"
            : undefined,
          type: "page",
          cssClass,
        });
      } else {
        // A markdown link []()
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
          displayLabel: namePrefix + labelText,
          boost: boost,
          apply: labelText.includes(" ") ? "<" + labelText + ">" : labelText,
          type: "page",
          cssClass,
        });
      }
      return completions;
    }).flat(),
  };
}

export async function languageComplete(completeEvent: CompleteEvent) {
  const languagePrefix = /^(?:```+|~~~+)(\w*)$/.exec(
    completeEvent.linePrefix,
  );
  if (!languagePrefix) {
    return null;
  }

  const allLanguages = await language.listLanguages();
  return {
    from: completeEvent.pos - languagePrefix[1].length,
    options: allLanguages.map(
      (lang) => ({
        label: lang,
        type: "language",
      }),
    ),
  };
}
