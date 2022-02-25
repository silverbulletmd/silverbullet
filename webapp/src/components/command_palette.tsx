import { AppCommand } from "../types";
import { isMacLike } from "../util";
import { FilterList, Option } from "./filter";

export function CommandPalette({
  commands,
  onTrigger,
}: {
  commands: Map<string, AppCommand>;
  onTrigger: (command: AppCommand | undefined) => void;
}) {
  let options: Option[] = [];
  const isMac = isMacLike();
  for (let [name, def] of commands.entries()) {
    options.push({
      name: name,
      hint: isMac && def.command.mac ? def.command.mac : def.command.key,
    });
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
