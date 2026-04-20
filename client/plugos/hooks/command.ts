import type { Hook, Manifest } from "../types.ts";
import type { System } from "../system.ts";
import { EventEmitter } from "../event.ts";
import { throttle } from "@silverbulletmd/silverbullet/lib/async";
import type { Command, CommandHookEvents } from "../../types/command.ts";
import type { CommandHookT } from "@silverbulletmd/silverbullet/type/manifest";

export class CommandHook
  extends EventEmitter<CommandHookEvents>
  implements Hook<CommandHookT>
{
  system?: System<CommandHookT>;
  public throttledBuildAllCommandsAndEmit = throttle(() => {
    this.buildAllCommandsAndEmit();
  }, 200);

  private registeredCommands = new Map<string, Command>();

  constructor(
    private readOnly: boolean,
    private additionalCommands: Map<string, Command>,
  ) {
    super();
  }

  /**
   * Register a command directly with the hook. Intended for client-side code
   * that wants to define commands without going through a plug manifest.
   * Overwrites any previously-registered command with the same name.
   */
  registerCommand(command: Command): void {
    this.registeredCommands.set(command.name, command);
    this.throttledBuildAllCommandsAndEmit();
  }

  private mergeCommand(
    commands: Map<string, Command>,
    name: string,
    cmd: Command,
  ) {
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
      commands.set(name, cmd);
    }
  }

  /**
   * Build the command map
   */
  buildAllCommands(): Map<string, Command> {
    const commands = new Map<string, Command>();
    // Start with directly-registered commands (built-in client commands).
    // These form the base layer and can be overridden by plug commands or
    // script commands further down.
    for (const [name, cmd] of this.registeredCommands) {
      if (cmd.requireMode === "rw" && this.readOnly) {
        continue;
      }
      commands.set(name, cmd);
    }
    // Add commands from plugs
    if (!this.system) {
      // Not initialized yet
      return commands;
    }
    for (const plug of this.system.loadedPlugs.values()) {
      for (const [name, functionDef] of Object.entries(
        plug.manifest!.functions,
      )) {
        if (!functionDef.command) {
          continue;
        }
        const cmd = functionDef.command;
        if (cmd.requireMode === "rw" && this.readOnly) {
          // Bit hacky, but don't expose commands that require write mode in read-only mode
          continue;
        }
        this.mergeCommand(commands, cmd.name, {
          ...cmd,
          run: (args?: string[]) => {
            return plug.invoke(name, [cmd, ...(args ?? [])]);
          },
        });
      }
    }
    // Script commands come last — they always win over built-ins and plugs,
    // so users can rebind keys / replace run bodies from Lua.
    for (const [name, cmd] of this.additionalCommands) {
      this.mergeCommand(commands, name, cmd);
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
