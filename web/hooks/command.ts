import type { Hook, Manifest } from "../../lib/plugos/types.ts";
import type { System } from "../../lib/plugos/system.ts";
import { EventEmitter } from "../../lib/plugos/event.ts";
import { throttle } from "../../lib/async.ts";
import type { AppCommand, CommandHookEvents } from "../../lib/command.ts";
import type { CommandHookT } from "$lib/manifest.ts";

export class CommandHook extends EventEmitter<CommandHookEvents>
  implements Hook<CommandHookT> {
  editorCommands = new Map<string, AppCommand>();
  system!: System<CommandHookT>;
  throttledBuildAllCommands = throttle(() => {
    this.buildAllCommands();
  }, 200);

  constructor(
    private readOnly: boolean,
    private additionalCommandsMap: Map<string, AppCommand>,
  ) {
    super();
  }

  buildAllCommands() {
    this.editorCommands.clear();
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
        this.editorCommands.set(cmd.name, {
          command: cmd,
          run: (args?: string[]) => {
            return plug.invoke(name, [cmd, ...args ?? []]);
          },
        });
      }
    }
    for (const [name, cmd] of this.additionalCommandsMap) {
      this.editorCommands.set(name, cmd);
    }
    this.emit("commandsUpdated", this.editorCommands);
  }

  apply(system: System<CommandHookT>): void {
    this.system = system;
    system.on({
      plugLoaded: () => {
        this.throttledBuildAllCommands();
      },
    });
    // On next tick
    setTimeout(() => {
      this.throttledBuildAllCommands();
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
