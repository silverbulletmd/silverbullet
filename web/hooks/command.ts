import { Hook, Manifest } from "../../plugos/types.ts";
import { System } from "../../plugos/system.ts";
import { EventEmitter } from "../../plugos/event.ts";

export type CommandDef = {
  name: string;

  contexts?: string[];

  // Default 0, higher is higher priority = higher in the list
  priority?: number;

  // Bind to keyboard shortcut
  key?: string;
  mac?: string;
};

export type AppCommand = {
  command: CommandDef;
  run: (args?: any[]) => Promise<void>;
};

export type CommandHookT = {
  command?: CommandDef;
};

export type CommandHookEvents = {
  commandsUpdated(commandMap: Map<string, AppCommand>): void;
};

export class CommandHook extends EventEmitter<CommandHookEvents>
  implements Hook<CommandHookT> {
  editorCommands = new Map<string, AppCommand>();

  buildAllCommands(system: System<CommandHookT>) {
    this.editorCommands.clear();
    for (const plug of system.loadedPlugs.values()) {
      for (
        const [name, functionDef] of Object.entries(
          plug.manifest!.functions,
        )
      ) {
        if (!functionDef.command) {
          continue;
        }
        const cmd = functionDef.command;
        this.editorCommands.set(cmd.name, {
          command: cmd,
          run: (args?: string[]) => {
            return plug.invoke(name, [cmd, ...args ?? []]);
          },
        });
      }
    }
    this.emit("commandsUpdated", this.editorCommands);
  }

  apply(system: System<CommandHookT>): void {
    system.on({
      plugLoaded: () => {
        this.buildAllCommands(system);
      },
    });
    // On next tick
    setTimeout(() => {
      this.buildAllCommands(system);
    });
  }

  validateManifest(manifest: Manifest<CommandHookT>): string[] {
    const errors = [];
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
