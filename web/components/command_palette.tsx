import { FilterList } from "./filter.tsx";
import type {
  CompletionContext,
  CompletionResult,
} from "@codemirror/autocomplete";
import { Terminal } from "preact-feather";
import type { AppCommand } from "../../lib/command.ts";
import type {
  FilterOption,
  Shortcut,
} from "@silverbulletmd/silverbullet/type/client";
import type { Config } from "$common/config.ts";

export function CommandPalette({
  commands,
  recentCommands,
  onTrigger,
  vimMode,
  darkMode,
  config,
  completer,
}: {
  commands: Map<string, AppCommand>;
  recentCommands: Map<string, Date>;
  vimMode: boolean;
  darkMode: boolean;
  completer: (context: CompletionContext) => Promise<CompletionResult | null>;
  config: Config;
  onTrigger: (command: AppCommand | undefined) => void;
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
    if (config.has("shortcuts")) {
      const shortcuts = config.get<Shortcut[]>("shortcuts", []);
      const commandOverride = shortcuts.find((shortcut) =>
        shortcut.command === name
      );
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
      helpText="Start typing the command name to filter results, press <code>Enter</code> to run."
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
