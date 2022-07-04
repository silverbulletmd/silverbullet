import { FilterList } from "./filter";
import { FilterOption, PageMeta } from "@silverbulletmd/common/types";

export function PageNavigator({
  allPages,
  onNavigate,
  currentPage,
}: {
  allPages: Set<PageMeta>;
  onNavigate: (page: string | undefined) => void;
  currentPage?: string;
}) {
  let options: FilterOption[] = [];
  for (let pageMeta of allPages) {
    if (currentPage && currentPage === pageMeta.name) {
      continue;
    }
    // Order by last modified date in descending order
    let orderId = -pageMeta.lastModified;
    // Unless it was opened in this session
    if (pageMeta.lastOpened) {
      orderId = -pageMeta.lastOpened;
    }
    options.push({
      ...pageMeta,
      orderId: orderId,
    });
  }
  let completePrefix: string | undefined = undefined;
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
      // icon={faFileLines}
      allowNew={true}
      helpText="Start typing the page name to filter results, press <code>Return</code> to open."
      newHint="Create page"
      completePrefix={completePrefix}
      onSelect={(opt) => {
        onNavigate(opt?.name);
      }}
    />
  );
}
