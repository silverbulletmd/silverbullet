import { Hook, Manifest } from "../../plugos/types.ts";
import { System } from "../../plugos/system.ts";
import { EventEmitter } from "../../plugos/event.ts";
import { ObjectValue } from "$sb/types.ts";
import {
  FrontmatterConfig,
  SnippetConfig,
} from "../../plugs/template/types.ts";
import { throttle } from "$sb/lib/async.ts";
import { NewPageConfig } from "../../plugs/template/types.ts";

export type CommandDef = {
  name: string;

  contexts?: string[];

  // Default 0, higher is higher priority = higher in the list
  priority?: number;

  // Bind to keyboard shortcut
  key?: string;
  mac?: string;

  hide?: boolean;
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
  }, 200);

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
    const templateCommands: ObjectValue<FrontmatterConfig>[] = await indexPlug
      .invoke(
        "queryObjects",
        ["template", {
          // where hooks.newPage.command or hooks.snippet.command
          filter: ["or", [
            "attr",
            ["attr", ["attr", "hooks"], "newPage"],
            "command",
          ], [
            "attr",
            ["attr", ["attr", "hooks"], "snippet"],
            "command",
          ]],
        }],
      );

    // console.log("Template commands", templateCommands);

    for (const page of templateCommands) {
      try {
        if (page.hooks!.newPage) {
          const newPageConfig = NewPageConfig.parse(page.hooks!.newPage);
          const cmdDef = {
            name: newPageConfig.command!,
            key: newPageConfig.key,
            mac: newPageConfig.mac,
          };
          this.editorCommands.set(newPageConfig.command!, {
            command: cmdDef,
            run: () => {
              return templatePlug.invoke("newPageCommand", [cmdDef, page.ref]);
            },
          });
        }
        if (page.hooks!.snippet) {
          const snippetConfig = SnippetConfig.parse(page.hooks!.snippet);
          const cmdDef = {
            name: snippetConfig.command!,
            key: snippetConfig.key,
            mac: snippetConfig.mac,
          };
          this.editorCommands.set(snippetConfig.command!, {
            command: cmdDef,
            run: () => {
              return templatePlug.invoke("insertSnippetTemplate", [
                { templatePage: page.ref },
              ]);
            },
          });
        }
      } catch (e: any) {
        console.error("Error loading command from", page.ref, e);
      }
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
