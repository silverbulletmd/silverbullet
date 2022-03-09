import { PageMeta } from "../types";
import { FilterList, Option } from "./filter";
import { faFileLines } from "@fortawesome/free-solid-svg-icons";

export function PageNavigator({
  allPages,
  onNavigate,
  currentPage,
}: {
  allPages: PageMeta[];
  onNavigate: (page: string | undefined) => void;
  currentPage?: string;
}) {
  let options: Option[] = [];
  for (let pageMeta of allPages) {
    if (currentPage && currentPage === pageMeta.name) {
      continue;
    }
    // Order by last modified date in descending order
    let orderId = -pageMeta.lastModified.getTime();
    // Unless it was opened and is still in memory
    if (pageMeta.lastOpened) {
      orderId = -pageMeta.lastOpened.getTime();
    }
    options.push({
      ...pageMeta,
      orderId: orderId,
    });
  }
  return (
    <FilterList
      placeholder="Page"
      label="Open"
      options={options}
      icon={faFileLines}
      allowNew={true}
      helpText="Start typing the page name to filter results, press <code>Return</code> to open."
      newHint="Create page"
      onSelect={(opt) => {
        onNavigate(opt?.name);
      }}
    />
  );
}
