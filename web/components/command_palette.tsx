import { FilterList } from "./filter.tsx";
import { CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { Terminal } from "preact-feather";
import { AppCommand } from "../../lib/command.ts";
import { FilterOption } from "$lib/web.ts";
import { BuiltinSettings } from "../../type/web.ts";
import { parseCommand } from "$common/command.ts";

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
    if (def.command.hide) {
      continue;
    }
    let shortcut: { key?: string; mac?: string; priority?: number } =
      def.command;
    // Let's see if there's a shortcut override
    if (settings.shortcuts) {
      const commandOverride = settings.shortcuts.find((
        shortcut,
      ) => {
        const parsedCommand = parseCommand(shortcut.command);
        // If this is a command link, we want to match the command name but also make sure no arguments were set
        return parsedCommand.name === name && parsedCommand.args.length === 0;
      });
      if (commandOverride) {
        shortcut = commandOverride;
        // console.log(`Shortcut override for ${name}:`, shortcut);
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
      icon={Terminal}
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

/**
 * Checks if the current platform is Mac-like (Mac, iPhone, iPod, iPad).
 * @returns A boolean indicating if the platform is Mac-like.
 */
function isMacLike() {
  return /(Mac|iPhone|iPod|iPad)/i.test(navigator.platform);
}
