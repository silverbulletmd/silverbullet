import { Hook, Manifest } from "../../plugos/types.ts";
import { System } from "../../plugos/system.ts";
import { Completion, CompletionContext, CompletionResult } from "../deps.ts";
import { safeRun } from "../../common/util.ts";
import { Client } from "../client.ts";
import { syntaxTree } from "../deps.ts";
import { SlashCompletion } from "$sb/app_event.ts";

export type SlashCommandDef = {
  name: string;
  description?: string;
  boost?: number;
};

export type AppSlashCommand = {
  slashCommand: SlashCommandDef;
  run: () => Promise<void>;
};

export type SlashCommandHookT = {
  slashCommand?: SlashCommandDef;
};

const slashCommandRegexp = /([^\w:]|^)\/[\w\-]*/;

export class SlashCommandHook implements Hook<SlashCommandHookT> {
  slashCommands = new Map<string, AppSlashCommand>();
  private editor: Client;

  constructor(editor: Client) {
    this.editor = editor;
  }

  buildAllCommands(system: System<SlashCommandHookT>) {
    this.slashCommands.clear();
    for (const plug of system.loadedPlugs.values()) {
      for (
        const [name, functionDef] of Object.entries(
          plug.manifest!.functions,
        )
      ) {
        if (!functionDef.slashCommand) {
          continue;
        }
        const cmd = functionDef.slashCommand;
        this.slashCommands.set(cmd.name, {
          slashCommand: cmd,
          run: () => {
            return plug.invoke(name, [cmd]);
          },
        });
      }
    }
  }

  // Completer for CodeMirror
  public async slashCommandCompleter(
    ctx: CompletionContext,
  ): Promise<CompletionResult | null> {
    const prefix = ctx.matchBefore(slashCommandRegexp);
    if (!prefix) {
      return null;
    }
    const prefixText = prefix.text;
    const options: Completion[] = [];

    // No slash commands in comment blocks (queries and such)
    const currentNode = syntaxTree(ctx.state).resolveInner(ctx.pos);
    if (currentNode.type.name === "CommentBlock") {
      return null;
    }

    for (const def of this.slashCommands.values()) {
      options.push({
        label: def.slashCommand.name,
        detail: def.slashCommand.description,
        boost: def.slashCommand.boost,
        apply: () => {
          // Delete slash command part
          this.editor.editorView.dispatch({
            changes: {
              from: prefix!.from + prefixText.indexOf("/"),
              to: ctx.pos,
              insert: "",
            },
          });
          // Replace with whatever the completion is
          safeRun(async () => {
            await def.run();
            this.editor.focus();
          });
        },
      });
    }

    const slashCompletions: SlashCompletion[] | null = await this.editor
      .completeWithEvent(
        ctx,
        "slash:complete",
      ) as any;

    if (slashCompletions) {
      for (const slashCompletion of slashCompletions) {
        options.push({
          label: slashCompletion.label,
          detail: slashCompletion.detail,
          apply: () => {
            // Delete slash command part
            this.editor.editorView.dispatch({
              changes: {
                from: prefix!.from + prefixText.indexOf("/"),
                to: ctx.pos,
                insert: "",
              },
            });
            // Replace with whatever the completion is
            safeRun(async () => {
              const [plugName, functionName] = slashCompletion.invoke.split(
                ".",
              );
              const plug = this.editor.system.system.loadedPlugs.get(plugName);
              if (!plug) {
                this.editor.flashNotification(
                  `Plug ${plugName} not found`,
                  "error",
                );
                return;
              }
              await plug.invoke(functionName, [slashCompletion]);
              this.editor.focus();
            });
          },
        });
      }
    }

    return {
      // + 1 because of the '/'
      from: prefix.from + prefixText.indexOf("/") + 1,
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
    const errors = [];
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
