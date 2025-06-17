import type { Hook, Manifest } from "../../lib/plugos/types.ts";
import type { System } from "../../lib/plugos/system.ts";
import { EventEmitter } from "../../lib/plugos/event.ts";
import { throttle } from "../../lib/async.ts";
import type { Command, CommandHookEvents } from "../../type/command.ts";
import type { CommandHookT } from "../../lib/manifest.ts";

export class CommandHook extends EventEmitter<CommandHookEvents>
  implements Hook<CommandHookT> {
  system?: System<CommandHookT>;
  public throttledBuildAllCommandsAndEmit = throttle(() => {
    this.buildAllCommandsAndEmit();
  }, 200);

  constructor(
    private readOnly: boolean,
    private additionalCommands: Map<string, Command>,
  ) {
    super();
  }

  /**
   * Build the command map
   */
  buildAllCommands(): Map<string, Command> {
    const commands = new Map<string, Command>();
    // Add commands from plugs
    if (!this.system) {
      // Not initialized yet
      return commands;
    }
    for (const plug of this.system.loadedPlugs.values()) {
      for (
        const [name, functionDef] of Object.entries(
          plug.manifest!.functions,
        )
      ) {
        if (!functionDef.command) {
          continue;
        }
        const cmd = functionDef.command;
        if (cmd.requireMode === "rw" && this.readOnly) {
          // Bit hacky, but don't expose commands that require write mode in read-only mode
          continue;
        }
        commands.set(cmd.name, {
          ...cmd,
          run: (args?: string[]) => {
            return plug.invoke(name, [cmd, ...args ?? []]);
          },
        });
      }
    }
    for (const [name, cmd] of this.additionalCommands) {
      if (commands.has(name)) {
        // Existing command, let's do some inline patching
        const existingCommand = commands.get(name)!;
        const command: Command = {
          ...existingCommand,
          ...cmd,
        };
        if (cmd.run) {
          command.run = cmd.run;
        }
        commands.set(name, command);
      } else {
        // New command, let's just set
        commands.set(name, cmd);
      }
    }
    return commands;
  }

  public buildAllCommandsAndEmit() {
    this.emit("commandsUpdated", this.buildAllCommands());
  }

  apply(system: System<CommandHookT>): void {
    this.system = system;
    system.on({
      plugLoaded: () => {
        this.throttledBuildAllCommandsAndEmit();
      },
    });
    // On next tick
    setTimeout(() => {
      this.throttledBuildAllCommandsAndEmit();
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
