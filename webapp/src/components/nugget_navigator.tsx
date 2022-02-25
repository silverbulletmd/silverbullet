import { NuggetMeta } from "../types";
import { FilterList } from "./filter";

export function NuggetNavigator({
  allNuggets: allNuggets,
  onNavigate,
}: {
  allNuggets: NuggetMeta[];
  onNavigate: (nugget: string | undefined) => void;
}) {
  return (
    <FilterList
      placeholder=""
      options={allNuggets.map((meta) => ({
        ...meta,
        // Order by last modified date in descending order
        orderId: -meta.lastModified.getTime(),
      }))}
      allowNew={true}
      newHint="Create nugget"
      onSelect={(opt) => {
        onNavigate(opt?.name);
      }}
    />
  );
}
