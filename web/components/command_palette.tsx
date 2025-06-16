import { FilterList } from "./filter.tsx";
import type {
  CompletionContext,
  CompletionResult,
} from "@codemirror/autocomplete";
import { Terminal } from "preact-feather";
import type { Command } from "../../lib/command.ts";
import type {
  FilterOption,
  Shortcut,
} from "@silverbulletmd/silverbullet/type/client";
import type { Config } from "../config.ts";

export function CommandPalette({
  commands,
  recentCommands,
  onTrigger,
  vimMode,
  darkMode,
  completer,
}: {
  commands: Map<string, Command>;
  recentCommands: Map<string, Date>;
  vimMode: boolean;
  darkMode?: boolean;
  completer: (context: CompletionContext) => Promise<CompletionResult | null>;
  onTrigger: (command: Command | undefined) => void;
}) {
  const options: FilterOption[] = [];
  const isMac = isMacLike();
  for (const [name, def] of commands.entries()) {
    if (def.hide) {
      continue;
    }
    options.push({
      name: name,
      hint: isMac && def.mac ? def.mac : def.key,
      orderId: recentCommands.has(name)
        ? -recentCommands.get(name)!.getTime()
        : def.priority || Infinity,
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
