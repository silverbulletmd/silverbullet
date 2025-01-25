import type { Hook, Manifest } from "$lib/plugos/types.ts";
import type { System } from "$lib/plugos/system.ts";
import type {
  Completion,
  CompletionContext,
  CompletionResult,
} from "@codemirror/autocomplete";
import type { Client } from "../client.ts";
import { syntaxTree } from "@codemirror/language";
import type {
  SlashCompletionOption,
  SlashCompletions,
} from "../../plug-api/types.ts";
import { safeRun, throttle } from "$lib/async.ts";
import type { SlashCommandDef, SlashCommandHookT } from "$lib/manifest.ts";
import { parseCommand } from "$common/command.ts";
import type { CommonSystem } from "$common/common_system.ts";

export type AppSlashCommand = {
  slashCommand: SlashCommandDef;
  run: () => Promise<void>;
};

const slashCommandRegexp = /([^\w:]|^)\/[\w#\-]*/;

export class SlashCommandHook implements Hook<SlashCommandHookT> {
  slashCommands = new Map<string, AppSlashCommand>();
  private editor: Client;

  constructor(editor: Client, private commonSystem: CommonSystem) {
    this.editor = editor;
  }

  throttledBuildAllCommands = throttle(() => {
    this.buildAllCommands();
  }, 200);

  buildAllCommands() {
    const system = this.commonSystem.system;

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
    // Iterate over script defined slash commands
    for (
      const [name, command] of Object.entries(
        this.commonSystem.scriptEnv.slashCommands,
      )
    ) {
      this.slashCommands.set(name, command);
    }
    // Iterate over all shortcuts
    if (this.editor.config?.shortcuts) {
      // Add slash commands for shortcuts that configure them
      for (const shortcut of this.editor.config.shortcuts) {
        if (shortcut.slashCommand) {
          const parsedCommand = parseCommand(shortcut.command);
          this.slashCommands.set(shortcut.slashCommand, {
            slashCommand: {
              name: shortcut.slashCommand,
              description: parsedCommand.alias || parsedCommand.name,
            },
            run: () => {
              return this.editor.runCommandByName(
                parsedCommand.name,
                parsedCommand.args,
              );
            },
          });
        }
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

    // No slash commands in comment blocks (queries and such) or links
    const currentNode = syntaxTree(ctx.state).resolveInner(ctx.pos);
    if (
      currentNode.type.name === "CommentBlock" ||
      currentNode.type.name === "Link"
    ) {
      return null;
    }

    // Check if the slash command is available in the current context
    const parentNodes = this.editor.extractParentNodes(ctx.state, currentNode);
    // console.log("Parent nodes", parentNodes);
    for (const def of this.slashCommands.values()) {
      if (
        def.slashCommand.contexts && !def.slashCommand.contexts.some(
          (context) => parentNodes.some((node) => node.startsWith(context)),
        )
      ) {
        continue;
      }
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
    this.buildAllCommands();
    system.on({
      plugLoaded: () => {
        this.buildAllCommands();
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
