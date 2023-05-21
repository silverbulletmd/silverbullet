import { isMacLike } from "../../common/util.ts";
import { FilterList } from "./filter.tsx";
import { CompletionContext, CompletionResult, TerminalIcon } from "../deps.ts";
import { AppCommand } from "../hooks/command.ts";
import { FilterOption } from "../types.ts";

export function CommandPalette({
  commands,
  recentCommands,
  onTrigger,
  vimMode,
  darkMode,
  completer,
}: {
  commands: Map<string, AppCommand>;
  recentCommands: Map<string, Date>;
  vimMode: boolean;
  darkMode: boolean;
  completer: (context: CompletionContext) => Promise<CompletionResult | null>;
  onTrigger: (command: AppCommand | undefined) => void;
}) {
  const options: FilterOption[] = [];
  const isMac = isMacLike();
  for (const [name, def] of commands.entries()) {
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
      icon={TerminalIcon}
      completer={completer}
      vimMode={vimMode}
      darkMode={darkMode}
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
