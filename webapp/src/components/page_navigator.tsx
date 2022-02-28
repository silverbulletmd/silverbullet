import { PageMeta } from "../types";
import { FilterList, Option } from "./filter";

export function PageNavigator({
  allPages,
  onNavigate,
  currentPage,
}: {
  allPages: PageMeta[];
  onNavigate: (page: string | undefined) => void;
  currentPage?: PageMeta;
}) {
  let options: Option[] = [];
  for (let pageMeta of allPages) {
    if (currentPage && currentPage.name == pageMeta.name) {
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
      placeholder=""
      options={options}
      allowNew={true}
      newHint="Create page"
      onSelect={(opt) => {
        onNavigate(opt?.name);
      }}
    />
  );
}
