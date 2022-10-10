import { isMacLike } from "../../common/util.ts";
import { FilterList } from "./filter.tsx";
import { faPersonRunning } from "../deps.ts";
import { AppCommand } from "../hooks/command.ts";
import { FilterOption } from "../../common/types.ts";

export function CommandPalette({
  commands,
  recentCommands,
  onTrigger,
}: {
  commands: Map<string, AppCommand>;
  recentCommands: Map<string, Date>;
  onTrigger: (command: AppCommand | undefined) => void;
}) {
  let options: FilterOption[] = [];
  const isMac = isMacLike();
  for (let [name, def] of commands.entries()) {
    options.push({
      name: name,
      hint: isMac && def.command.mac ? def.command.mac : def.command.key,
      orderId: recentCommands.has(name)
        ? -recentCommands.get(name)!.getTime()
        : 0,
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
