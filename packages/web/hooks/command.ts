import { Hook, Manifest } from "@plugos/plugos/types";
import { System } from "@plugos/plugos/system";
import { EventEmitter } from "@plugos/plugos/event";
import { ShortcutItem } from "../types";

export type CommandDef = {
  name: string;

  contexts?: string[];

  // Bind to keyboard shortcut
  key?: string;
  mac?: string;

  // Shortcuts in UI
  shortcut?: ShortcutDef;
};

export type ShortcutDef = {
  label: string;
};

export type AppCommand = {
  command: CommandDef;
  run: () => Promise<void>;
};

export type CommandHookT = {
  command?: CommandDef;
};

export type CommandHookEvents = {
  commandsUpdated(
    commandMap: Map<string, AppCommand>,
    appButtons: ShortcutItem[]
  ): void;
};

export class CommandHook
  extends EventEmitter<CommandHookEvents>
  implements Hook<CommandHookT>
{
  editorCommands = new Map<string, AppCommand>();
  shortcutItems: ShortcutItem[] = [];

  buildAllCommands(system: System<CommandHookT>) {
    this.editorCommands.clear();
    this.shortcutItems = [];
    for (let plug of system.loadedPlugs.values()) {
      for (const [name, functionDef] of Object.entries(
        plug.manifest!.functions
      )) {
        if (!functionDef.command) {
          continue;
        }
        const cmd = functionDef.command;
        this.editorCommands.set(cmd.name, {
          command: cmd,
          run: () => {
            return plug.invoke(name, []);
          },
        });
        if (cmd.shortcut) {
          this.shortcutItems.push({
            label: cmd.shortcut.label,
            run: () => {
              return plug.invoke(name, []);
            },
          });
        }
      }
    }
    this.emit("commandsUpdated", this.editorCommands, this.shortcutItems);
  }

  apply(system: System<CommandHookT>): void {
    this.buildAllCommands(system);
    system.on({
      plugLoaded: () => {
        this.buildAllCommands(system);
      },
    });
  }

  validateManifest(manifest: Manifest<CommandHookT>): string[] {
    let errors = [];
    for (const [name, functionDef] of Object.entries(manifest.functions)) {
      if (!functionDef.command) {
        continue;
      }
      const cmd = functionDef.command;
      if (!cmd.name) {
        errors.push(`Function ${name} has a command but no name`);
      }
    }
    return [];
  }
}
