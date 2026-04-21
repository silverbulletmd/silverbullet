import { FilterList } from "./filter.tsx";
import { Terminal } from "preact-feather";
import type { Command } from "../types/command.ts";
import type { FilterOption } from "@silverbulletmd/silverbullet/type/client";
import { isMacLike, prettifyShortcut } from "../../plug-api/lib/shortcut.ts";

export function CommandPalette({
  commands,
  onTrigger,
  darkMode,
}: {
  commands: Map<string, Command>;
  darkMode?: boolean;
  onTrigger: (command: Command | undefined) => void;
}) {
  const options: FilterOption[] = [];
  for (const [name, def] of commands.entries()) {
    if (def.hide) {
      continue;
    }

    options.push({
      name: name,
      hint: keyboardHint(def),
      orderId:
        def.lastRun !== undefined ? -def.lastRun : def.priority || Infinity,
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

export function keyboardHint(def: { key?: string | string[]; mac?: string | string[] }): string | undefined {
  const shortcuts: string[] = [];
  if (isMacLike && def.mac) {
    if (Array.isArray(def.mac)) {
      shortcuts.push(...def.mac);
    } else {
      shortcuts.push(def.mac);
    }
  } else if (def.key) {
    if (Array.isArray(def.key)) {
      shortcuts.push(...def.key);
    } else {
      shortcuts.push(def.key);
    }
  }
  return shortcuts.length > 0
    ? shortcuts.map(prettifyShortcut).join(" | ")
    : undefined;
}
