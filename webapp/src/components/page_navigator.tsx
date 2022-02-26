import { PageMeta } from "../types";
import { FilterList } from "./filter";

export function PageNavigator({
  allPages: allPages,
  onNavigate,
}: {
  allPages: PageMeta[];
  onNavigate: (page: string | undefined) => void;
}) {
  return (
    <FilterList
      placeholder=""
      options={allPages.map((meta) => ({
        ...meta,
        // Order by last modified date in descending order
        orderId: -meta.lastModified.getTime(),
      }))}
      allowNew={true}
      newHint="Create page"
      onSelect={(opt) => {
        onNavigate(opt?.name);
      }}
    />
  );
}
