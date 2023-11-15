import { FilterList } from "./filter.tsx";
import { FilterOption } from "../types.ts";
import { CompletionContext, CompletionResult } from "../deps.ts";
import { PageMeta } from "$sb/types.ts";
import { isFederationPath } from "$sb/lib/resolve.ts";

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
    options.push({
      ...pageMeta,
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
