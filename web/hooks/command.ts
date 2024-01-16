import { Hook, Manifest } from "../../plugos/types.ts";
import { System } from "../../plugos/system.ts";
import { EventEmitter } from "../../plugos/event.ts";
import { ObjectValue } from "$sb/types.ts";
import { TemplateFrontmatter } from "../../plugs/template/types.ts";
import { throttle } from "$sb/lib/async.ts";

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
  system!: System<CommandHookT>;

  throttledBuildAllCommands = throttle(() => {
    this.buildAllCommands().catch(console.error);
  }, 1000);

  async buildAllCommands() {
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
        this.editorCommands.set(cmd.name, {
          command: cmd,
          run: (args?: string[]) => {
            return plug.invoke(name, [cmd, ...args ?? []]);
          },
        });
      }
    }
    await this.loadPageTemplateCommands();
    this.emit("commandsUpdated", this.editorCommands);
  }

  async loadPageTemplateCommands() {
    // This relies on two plugs being loaded: index and template
    const indexPlug = this.system.loadedPlugs.get("index");
    const templatePlug = this.system.loadedPlugs.get("template");
    if (!indexPlug || !templatePlug) {
      // Index and template plugs not yet loaded, let's wait
      return;
    }

    // Query all page templates that have a command configured
    const pageTemplateCommands: ObjectValue<TemplateFrontmatter>[] =
      await indexPlug.invoke(
        "queryObjects",
        ["template", {
          // where hooks.pageTemplate.command.name and hooks.pageTemplate.enabled != false
          filter: ["and", ["attr", [
            "attr",
            ["attr", ["attr", "hooks"], "pageTemplate"],
            "command",
          ], "name"], ["!=", [
            "attr",
            ["attr", ["attr", "hooks"], "pageTemplate"],
            "enabled",
          ], ["boolean", false]]],
        }],
      );

    for (const page of pageTemplateCommands) {
      const pageTemplate = page.hooks!.pageTemplate!;
      const cmdDef = pageTemplate.command!;
      this.editorCommands.set(pageTemplate.command!.name!, {
        command: cmdDef as any,
        run: () => {
          return templatePlug.invoke("newPageCommand", [cmdDef, page.ref]);
        },
      });
    }

    // console.log("Page template commands", pageTemplateCommands);
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
