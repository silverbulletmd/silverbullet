import { isMacLike } from "../../common/util.ts";
import { FilterList } from "./filter.tsx";
import { CompletionContext, CompletionResult, TerminalIcon } from "../deps.ts";
import { AppCommand } from "../hooks/command.ts";
import { BuiltinSettings, FilterOption } from "../types.ts";
import { commandLinkRegex } from "../../common/markdown_parser/parser.ts";

export function CommandPalette({
  commands,
  recentCommands,
  onTrigger,
  vimMode,
  darkMode,
  completer,
  settings,
}: {
  commands: Map<string, AppCommand>;
  recentCommands: Map<string, Date>;
  vimMode: boolean;
  darkMode: boolean;
  completer: (context: CompletionContext) => Promise<CompletionResult | null>;
  onTrigger: (command: AppCommand | undefined) => void;
  settings: BuiltinSettings;
}) {
  const options: FilterOption[] = [];
  const isMac = isMacLike();
  for (const [name, def] of commands.entries()) {
    let shortcut: { key?: string; mac?: string; priority?: number } =
      def.command;
    // Let's see if there's a shortcut override
    if (settings.shortcuts) {
      const commandOverride = settings.shortcuts.find((
        shortcut,
      ) => {
        const commandMatch = commandLinkRegex.exec(shortcut.command);
        // If this is a command link, we want to match the command name but also make sure no arguments were set
        return commandMatch && commandMatch[1] === name && !commandMatch[5] ||
          // or if it's not a command link, let's match exactly
          shortcut.command === name;
      });
      if (commandOverride) {
        shortcut = commandOverride;
        console.log(`Shortcut override for ${name}:`, shortcut);
      }
    }
    options.push({
      name: name,
      hint: isMac && shortcut.mac ? shortcut.mac : shortcut.key,
      orderId: recentCommands.has(name)
        ? -recentCommands.get(name)!.getTime()
        : shortcut.priority || Infinity,
    });
    // console.log("Options", options);
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
