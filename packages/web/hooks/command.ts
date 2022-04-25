import { Hook, Manifest } from "@plugos/plugos/types";
import { System } from "@plugos/plugos/system";
import { EventEmitter } from "@plugos/plugos/event";

export type CommandDef = {
  name: string;

  contexts?: string[];

  // Bind to keyboard shortcut
  key?: string;
  mac?: string;
};

export type AppCommand = {
  command: CommandDef;
  run: () => Promise<void>;
};

export type CommandHookT = {
  command?: CommandDef;
};

export type CommandHookEvents = {
  commandsUpdated(commandMap: Map<string, AppCommand>): void;
};

export class CommandHook
  extends EventEmitter<CommandHookEvents>
  implements Hook<CommandHookT>
{
  editorCommands = new Map<string, AppCommand>();

  buildAllCommands(system: System<CommandHookT>) {
    this.editorCommands.clear();
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
      }
    }
    this.emit("commandsUpdated", this.editorCommands);
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
