import { NoteMeta } from "../types";
import { FilterList } from "./filter";

export function NoteNavigator({
  allNotes,
  onNavigate,
}: {
  allNotes: NoteMeta[];
  onNavigate: (note: string | undefined) => void;
}) {
  return (
    <FilterList
      placeholder=""
      options={allNotes}
      allowNew={true}
      newHint="Create note"
      onSelect={(opt) => {
        onNavigate(opt?.name);
      }}
    />
  );
}
