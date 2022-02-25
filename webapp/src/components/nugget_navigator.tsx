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
      options={allNuggets}
      allowNew={true}
      newHint="Create nugget"
      onSelect={(opt) => {
        onNavigate(opt?.name);
      }}
    />
  );
}
