import { FilterList } from "./filter.tsx";
import { Terminal } from "preact-feather";
import type { Command } from "../types/command.ts";
import type { FilterOption } from "@silverbulletmd/silverbullet/type/client";

export function CommandPalette({
  commands,
  onTrigger,
  vimMode,
  darkMode,
}: {
  commands: Map<string, Command>;
  vimMode: boolean;
  darkMode?: boolean;
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
      orderId: def.lastRun !== undefined
        ? -def.lastRun
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
