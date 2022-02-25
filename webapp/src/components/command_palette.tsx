import { AppCommand } from "../types";
import { FilterList, Option } from "./filter";

export function CommandPalette({
  commands,
  onTrigger,
}: {
  commands: Map<string, AppCommand>;
  onTrigger: (command: AppCommand | undefined) => void;
}) {
  let options: Option[] = [];
  for (let [name, def] of commands.entries()) {
    options.push({ name: name });
  }
  console.log("Commands", options);
  return (
    <FilterList
      placeholder="Enter command to run"
      options={options}
      allowNew={false}
      onSelect={(opt) => {
        if (opt) {
          onTrigger(commands.get(opt.name));
        } else {
          onTrigger(undefined);
        }
      }}
    />
  );
}
