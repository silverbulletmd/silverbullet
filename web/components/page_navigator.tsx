import { FilterList } from "./filter.tsx";
import { FilterOption } from "../types.ts";
import { CompletionContext, CompletionResult } from "../deps.ts";
import { PageMeta } from "$sb/types.ts";
import { isFederationPath } from "$sb/lib/resolve.ts";

const tagRegex = /#[^#\d\s\[\]]+\w+/g;

export function PageNavigator({
  allPages,
  onNavigate,
  completer,
  vimMode,
  darkMode,
  currentPage,
}: {
  allPages: PageMeta[];
  vimMode: boolean;
  darkMode: boolean;
  onNavigate: (page: string | undefined) => void;
  completer: (context: CompletionContext) => Promise<CompletionResult | null>;
  currentPage?: string;
}) {
  const options: FilterOption[] = [];
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
    if (currentPage && currentPage === pageMeta.name) {
      // ... then we put it all the way to the end
      orderId = Infinity;
    }
    // And deprioritize federated pages too
    if (isFederationPath(pageMeta.name)) {
      orderId = Math.round(orderId / 10); // Just 10x lower the timestamp to push them down, should work
    }
    let description: string | undefined;
    let aliases: string[] = [];
    if (pageMeta.displayName) {
      aliases.push(pageMeta.displayName);
    }
    if (Array.isArray(pageMeta.aliases)) {
      aliases = aliases.concat(pageMeta.aliases);
    }
    if (aliases.length > 0) {
      description = "(a.k.a. " + aliases.join(", ") + ") ";
    }
    if (pageMeta.tags) {
      description = (description || "") +
        pageMeta.tags.map((tag) => `#${tag}`).join(" ");
    }
    options.push({
      ...pageMeta,
      description,
      orderId: orderId,
    });
  }
  let completePrefix = currentPage + "/";
  if (currentPage && currentPage.includes("/")) {
    const pieces = currentPage.split("/");
    completePrefix = pieces.slice(0, pieces.length - 1).join("/") + "/";
  } else if (currentPage && currentPage.includes(" ")) {
    completePrefix = currentPage.split(" ")[0] + " ";
  }
  return (
    <FilterList
      placeholder="Page"
      label="Open"
      options={options}
      vimMode={vimMode}
      darkMode={darkMode}
      completer={completer}
      phrasePreprocessor={(phrase) => {
        phrase = phrase.replaceAll(tagRegex, "").trim();
        return phrase;
      }}
      preFilter={(options, phrase) => {
        const allTags = phrase.match(tagRegex);
        if (allTags) {
          // Search phrase contains hash tags, let's pre-filter the results based on this
          const filterTags = allTags.map((t) => t.slice(1));
          options = options.filter((pageMeta) => {
            if (!pageMeta.tags) {
              return false;
            }
            return filterTags.every((tag) =>
              pageMeta.tags.find((itemTag: string) => itemTag.startsWith(tag))
            );
          });
        }
        return options;
      }}
      allowNew={true}
      helpText="Press <code>Enter</code> to open the selected page, or <code>Shift-Enter</code> to create a new page with this exact name."
      newHint="Create page"
      completePrefix={completePrefix}
      onSelect={(opt) => {
        onNavigate(opt?.name);
      }}
    />
  );
}
