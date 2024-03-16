import { Hook, Manifest } from "$lib/plugos/types.ts";
import { System } from "$lib/plugos/system.ts";
import {
  Completion,
  CompletionContext,
  CompletionResult,
} from "@codemirror/autocomplete";
import { Client } from "../client.ts";
import { syntaxTree } from "@codemirror/language";
import {
  SlashCompletionOption,
  SlashCompletions,
} from "../../plug-api/types.ts";
import { safeRun } from "$lib/async.ts";
import { SlashCommandDef, SlashCommandHookT } from "$lib/manifest.ts";

export type AppSlashCommand = {
  slashCommand: SlashCommandDef;
  run: () => Promise<void>;
};

const slashCommandRegexp = /([^\w:]|^)\/[\w#\-]*/;

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

    const slashCompletions: CompletionResult | SlashCompletions | null =
      await this.editor
        .completeWithEvent(
          ctx,
          "slash:complete",
        );

    if (slashCompletions) {
      for (
        const slashCompletion of slashCompletions
          .options as SlashCompletionOption[]
      ) {
        options.push({
          label: slashCompletion.label,
          detail: slashCompletion.detail,
          boost: slashCompletion.order && -slashCompletion.order,
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
              await this.editor.clientSystem.system.invokeFunction(
                slashCompletion.invoke,
                [slashCompletion],
              );
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
