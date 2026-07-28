import { useEffect, useRef, useState } from "preact/hooks";
import { FilterList } from "./filter.tsx";
import type { FilterOption } from "@silverbulletmd/silverbullet/type/client";
import { tagRegex as mdTagRegex } from "../markdown_parser/constants.ts";
import {
  extractHashtag,
  isMetaTag,
} from "@silverbulletmd/silverbullet/lib/tags";
import type {
  DocumentMeta,
  PageMeta,
} from "@silverbulletmd/silverbullet/type/index";
import {
  getNameFromPath,
  parseToRef,
  type Path,
  type Ref,
} from "@silverbulletmd/silverbullet/lib/ref";
import { folderName } from "@silverbulletmd/silverbullet/lib/resolve";
import { type AnchorObject, anchorsToFilterOptions } from "./anchor_options.ts";

const tagRegex = new RegExp(mdTagRegex.source, "g");

export function AnythingPicker({
  allPages,
  allDocuments,
  extensions,
  onNavigate,
  onNavigateRef,
  onModeSwitch,
  mode,
  darkMode,
  currentPath,
}: {
  allDocuments: DocumentMeta[];
  allPages: PageMeta[];
  extensions: Set<string>;
  darkMode?: boolean;
  mode: "page" | "meta" | "document" | "all";
  onNavigate: (name: string | null) => void;
  onNavigateRef: (ref: Ref) => void;
  onModeSwitch: (mode: "page" | "meta" | "document" | "all") => void;
  currentPath: Path;
}) {
  const [anchorMode, setAnchorMode] = useState(false);
  // null = not loaded yet. Loaded at most once per picker lifetime, and
  // only if the user actually types "$" — costs nothing otherwise.
  const [anchors, setAnchors] = useState<AnchorObject[] | null>(null);
  // Tracks whether the load has already been kicked off, independent of
  // whether it has resolved yet. `anchors` stays null for the whole
  // duration of the in-flight request, so gating on `anchors !== null`
  // would let a second query fire if the user toggles anchor mode off
  // and back on before the first request completes. This ref is set
  // synchronously before the request starts and never cleared, so at
  // most one request is ever issued per picker lifetime (a failed load
  // is not retried either).
  const loadStarted = useRef(false);

  useEffect(() => {
    if (!anchorMode || loadStarted.current) {
      return;
    }
    loadStarted.current = true;
    client
      .queryLuaObjects<AnchorObject>("anchor", {})
      .then(setAnchors)
      .catch((e: Error) => {
        console.error("Failed to load anchors", e);
        client.ui.flashNotification(
          `Failed to load anchors: ${e.message}`,
          "error",
        );
        setAnchors([]);
      });
  }, [anchorMode]);

  const options: FilterOption[] = [];

  if (!anchorMode && (mode === "document" || mode === "all")) {
    for (const documentMeta of allDocuments) {
      const isViewable = extensions.has(documentMeta.extension);

      let orderId = isViewable
        ? -new Date(documentMeta.lastModified).getTime()
        : Number.MAX_VALUE - new Date(documentMeta.lastModified).getTime();

      if (currentPath === documentMeta.name) {
        orderId = Infinity;
      }

      // Can't really add tags to document as of right now, but maybe in the future
      let description: string | undefined;
      if (documentMeta.tags) {
        description =
          (description || "") +
          documentMeta.tags.map((tag) => `#${tag}`).join(" ");
      }

      if (!isViewable && client.clientSystem.readOnlyMode) {
        continue;
      }

      options.push({
        type: "document",
        meta: documentMeta,
        name: documentMeta.name,
        description,
        orderId: orderId,
        hint: documentMeta.name.split(".").pop()?.toUpperCase(),
        hintInactive: !isViewable,
      });
    }
  }

  if (!anchorMode && mode !== "document") {
    for (const pageMeta of allPages) {
      // Sanitize the page name
      if (!pageMeta.name) {
        pageMeta.name = pageMeta.ref;
      }
      // Order by last modified date in descending order
      let orderId = -new Date(pageMeta.lastModified).getTime();
      // Unless it was opened in this session
      if (pageMeta.lastOpened) {
        orderId = -pageMeta.lastOpened;
      }
      // Or it's the currently open page
      if (currentPath === `${pageMeta.name}.md` || pageMeta._isAspiring) {
        // ... then we put it all the way to the end
        orderId = Infinity;
      }
      const cssClass = (pageMeta.pageDecoration?.cssClasses || [])
        .join(" ")
        .replaceAll(/[^a-zA-Z0-9-_ ]/g, "");

      if (mode === "page") {
        // Special behavior for regular pages
        let description: string | undefined;
        let aliases: string[] = [];
        if (pageMeta.displayName) {
          aliases.push(pageMeta.displayName);
        }
        if (Array.isArray(pageMeta.aliases)) {
          aliases = aliases.concat(pageMeta.aliases);
        }
        if (aliases.length > 0) {
          description = `(a.k.a. ${aliases.join(", ")}) `;
        }
        if (pageMeta.tags) {
          description =
            (description || "") +
            pageMeta.tags.map((tag) => `#${tag}`).join(" ");
        }
        options.push({
          type: "page",
          meta: pageMeta,
          name: pageMeta.name,
          prefix: pageMeta.pageDecoration?.prefix,
          description,
          orderId: orderId,
          hint: pageMeta._isAspiring ? "Create page" : undefined,
          cssClass,
        });
      } else if (mode === "meta") {
        // Special behavior for #meta pages
        if (pageMeta._isAspiring) {
          // Skip over broken links
          continue;
        }
        options.push({
          type: "page",
          meta: pageMeta,
          name: pageMeta.name,
          description: pageMeta.description
            ? pageMeta.description.slice(0, 200)
            : "",
          hint: pageMeta.tags![0],
          orderId: orderId,
          cssClass,
        });
      } else {
        // all
        // In mode "all" just show the full path and all tags
        let description: string | undefined;
        if (pageMeta.tags) {
          description = pageMeta.tags.map((tag) => `#${tag}`).join(" ");
        }
        options.push({
          type: "page",
          meta: pageMeta,
          name: pageMeta.name,
          description,
          orderId: orderId,
          cssClass,
        });
      }
    }
  }

  if (anchorMode) {
    options.push(...anchorsToFilterOptions(anchors ?? []));
  }

  const completePrefix = `${folderName(currentPath) || getNameFromPath(currentPath)}/`;

  const allowNew = mode !== "document";
  const creatablePageNoun = mode !== "all" ? mode : "page";
  const openablePageNoun = mode !== "all" ? mode : "page or document";

  return (
    <FilterList
      placeholder={
        anchorMode
          ? "Anchor"
          : mode === "page"
            ? "Page"
            : mode === "meta"
              ? "#meta page"
              : mode === "document"
                ? "Document"
                : "Any page or Document, also hidden"
      }
      label="Open"
      options={options}
      darkMode={darkMode}
      onPhraseChange={(phrase) => {
        const next = phrase.startsWith("$");
        // Only touch state at the mode boundary. Setting it on every
        // keystroke would re-render this component and remap the entire
        // page list each time.
        if (next !== anchorMode) {
          setAnchorMode(next);
        }
      }}
      phrasePreprocessor={
        anchorMode
          ? undefined
          : (phrase) => {
              phrase = phrase.replaceAll(tagRegex, "").trim();
              return phrase;
            }
      }
      onKeyPress={(value, event) => {
        const text = value;
        // Pages cannot start with ^, as documented in Page Name Rules
        if (event.key === "^" && text === "^") {
          switch (mode) {
            case "page":
              onModeSwitch("meta");
              break;
            case "meta":
              onModeSwitch("document");
              break;
            case "document":
              onModeSwitch("all");
              break;
            case "all":
              onModeSwitch("page");
              break;
          }
          return true;
        }
        return false;
      }}
      preFilter={
        anchorMode
          ? undefined
          : (options, phrase) => {
              if (mode === "page") {
                const allTags = phrase.match(tagRegex);
                if (allTags) {
                  // Search phrase contains hash tags, let's pre-filter the results based on this
                  const filterTags = allTags.map((t) => extractHashtag(t));
                  options = options.filter((page) => {
                    if (!page.meta.tags) {
                      return false;
                    }
                    return filterTags.every((tag) =>
                      page.meta.tags.find((itemTag: string) =>
                        itemTag.startsWith(tag),
                      ),
                    );
                  });
                }
                // Remove pages that are tagged as templates or meta
                options = options.filter((page) => !isMetaPageOption(page));
              } else if (mode === "meta") {
                // Filter on pages tagged with "template" or "meta" prefix
                options = options.filter(isMetaPageOption);
              }

              if (mode !== "all") {
                // Filter out hidden pages
                options = options.filter(
                  (page) => !(page.meta.pageDecoration?.hide === true),
                );
              }
              return options;
            }
      }
      allowNew={anchorMode ? false : allowNew}
      helpText={
        anchorMode
          ? "Press <code>Enter</code> to jump to the selected anchor. If the list below is empty, your space has no anchors yet."
          : `Press <code>Enter</code> to open the selected ${openablePageNoun}` +
            (allowNew
              ? `, or <code>Shift-Enter</code> to create a new ${creatablePageNoun} with this exact name.`
              : "")
      }
      newHint={`Create ${creatablePageNoun}`}
      completePrefix={anchorMode ? undefined : completePrefix}
      onSelect={(opt) => {
        if (!opt) {
          onNavigate(null);
          return;
        }

        if (opt.type === "anchor") {
          const anchor = opt.meta as AnchorObject;
          // Page-qualified on purpose: duplicate anchor names each get
          // their own row, and this navigates to the one actually picked
          // instead of tripping the duplicate-anchor error path.
          onNavigateRef({
            path: `${anchor.page}.md` as Path,
            details: { type: "anchor", name: anchor.ref },
          });
          return;
        }

        const ref: string | undefined = opt.meta?.ref;
        const path = ref ? parseToRef(ref)?.path : null;
        const name = path ? getNameFromPath(path) : opt.name;
        onNavigate(name);
      }}
    />
  );
}

function isMetaPageOption(page: FilterOption) {
  return (
    page.meta.tags?.includes("template") ||
    page.meta.tags?.find((tag: string) => isMetaTag(tag))
  );
}
