import { Hook, Manifest } from "../../plugos/types";
import { System } from "../../plugos/system";
import { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { slashCommandRegexp } from "../types";
import { safeRun } from "../util";
import { Editor } from "../editor";

export type SlashCommandDef = {
  name: string;
};

export type AppSlashCommand = {
  slashCommand: SlashCommandDef;
  run: () => Promise<void>;
};

export type SlashCommandHookT = {
  slashCommand?: SlashCommandDef;
};

export class SlashCommandHook implements Hook<SlashCommandHookT> {
  slashCommands = new Map<string, AppSlashCommand>();
  private editor: Editor;

  constructor(editor: Editor) {
    this.editor = editor;
  }

  buildAllCommands(system: System<SlashCommandHookT>) {
    this.slashCommands.clear();
    for (let plug of system.loadedPlugs.values()) {
      for (const [name, functionDef] of Object.entries(
        plug.manifest!.functions
      )) {
        if (!functionDef.slashCommand) {
          continue;
        }
        const cmd = functionDef.slashCommand;
        this.slashCommands.set(cmd.name, {
          slashCommand: cmd,
          run: () => {
            return plug.invoke(name, []);
          },
        });
      }
    }
  }

  // Completer for CodeMirror
  public slashCommandCompleter(
    ctx: CompletionContext
  ): CompletionResult | null {
    let prefix = ctx.matchBefore(slashCommandRegexp);
    if (!prefix) {
      return null;
    }
    let options: Completion[] = [];
    for (let [name, def] of this.slashCommands.entries()) {
      options.push({
        label: def.slashCommand.name,
        detail: name,
        apply: () => {
          // Delete slash command part
          this.editor.editorView?.dispatch({
            changes: {
              from: prefix!.from,
              to: ctx.pos,
              insert: "",
            },
          });
          // Replace with whatever the completion is
          safeRun(async () => {
            await def.run();
          });
        },
      });
    }
    return {
      // + 1 because of the '/'
      from: prefix.from + 1,
      options: options,
    };
  }

  apply(system: System<SlashCommandHookT>): void {
    this.buildAllCommands(system);
    system.on({
      plugLoaded: () => {
        this.buildAllCommands(system);
      },
    });
  }

  validateManifest(manifest: Manifest<SlashCommandHookT>): string[] {
    let errors = [];
    for (const [name, functionDef] of Object.entries(manifest.functions)) {
      if (!functionDef.slashCommand) {
        continue;
      }
      const cmd = functionDef.slashCommand;
      if (!cmd.name) {
        errors.push(`Function ${name} has a command but no name`);
      }
    }
    return [];
  }
}
