import { FilterList } from "./filter.tsx";
import { FilterOption } from "$lib/web.ts";
import { CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { PageMeta } from "../../plug-api/types.ts";
import { isFederationPath } from "$sb/lib/resolve.ts";
import { tagRegex as mdTagRegex } from "$common/markdown_parser/parser.ts";

const tagRegex = new RegExp(mdTagRegex.source, "g");

export function PageNavigator({
  allPages,
  onNavigate,
  completer,
  vimMode,
  mode,
  darkMode,
  currentPage,
}: {
  allPages: PageMeta[];
  vimMode: boolean;
  darkMode: boolean;
  mode: "page" | "template";
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
    } else {
      // Special behavior for templates
      options.push({
        ...pageMeta,
        // Use the displayName or last bit of the path as the name
        name: pageMeta.displayName || pageMeta.name.split("/").pop()!,
        // And use the full path as the description
        description: pageMeta.name,
        orderId: orderId,
      });
    }
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
      placeholder={mode === "page" ? "Page" : "Template"}
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
        if (mode === "page") {
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
          options = options.filter((pageMeta) => {
            return !pageMeta.tags?.includes("template");
          });
          return options;
        } else {
          // Filter on pages tagged with "template"
          options = options.filter((pageMeta) => {
            return pageMeta.tags?.includes("template");
          });
          return options;
        }
      }}
      allowNew={true}
      helpText={`Press <code>Enter</code> to open the selected ${mode}, or <code>Shift-Enter</code> to create a new ${mode} with this exact name.`}
      newHint={`Create ${mode}`}
      completePrefix={completePrefix}
      onSelect={(opt) => {
        onNavigate(opt?.ref || opt?.name);
      }}
    />
  );
}
