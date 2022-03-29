import { isMacLike } from "../util";
import { FilterList, Option } from "./filter";
import { faPersonRunning } from "@fortawesome/free-solid-svg-icons";
import { AppCommand } from "../hooks/command";

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
  return (
    <FilterList
      label="Run"
      placeholder="Command"
      options={options}
      allowNew={false}
      icon={faPersonRunning}
      helpText="Start typing the command name to filter results, press <code>Return</code> to run."
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
