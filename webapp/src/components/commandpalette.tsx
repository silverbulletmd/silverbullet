import { AppCommand } from "../types";
import { FilterList } from "./filter";

export function CommandPalette({
  commands,
  onTrigger,
}: {
  commands: AppCommand[];
  onTrigger: (command: AppCommand) => void;
}) {
  return (
    <FilterList
      placeholder="Enter command to run"
      options={commands}
      allowNew={false}
      onSelect={(opt) => {
        onTrigger(opt as AppCommand);
      }}
    />
  );
}
