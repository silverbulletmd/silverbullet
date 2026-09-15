import type { Hook, Manifest } from "../types.ts";
import type { System } from "../system.ts";
import type {
  Completion,
  CompletionContext,
  CompletionResult,
} from "@codemirror/autocomplete";
import type { Client } from "../../client.ts";
import { syntaxTree } from "@codemirror/language";
import { safeRun, throttle } from "@silverbulletmd/silverbullet/lib/async";
import type { SlashCommandHookT } from "@silverbulletmd/silverbullet/type/manifest";
import type { SlashCommand } from "../../types/command.ts";
import type {
  SlashCompletionOption,
  SlashCompletions,
} from "@silverbulletmd/silverbullet/type/client";

const slashCommandRegexp = /([^\w:]|^)\/[\w#-]*/;

export class SlashCommandHook implements Hook<SlashCommandHookT> {
  slashCommands: SlashCommand[] = [];
  throttledBuildAllCommands = throttle(() => {
    this.buildAllCommands();
  }, 200);

  constructor(private client: Client) {}

  buildAllCommands() {
    const clientSystem = this.client.clientSystem;
    const system = clientSystem.system;

    this.slashCommands = [];
    for (const plug of system.loadedPlugs.values()) {
      for (const [name, functionDef] of Object.entries(
        plug.manifest!.functions,
      )) {
        if (!functionDef.slashCommand) {
          continue;
        }
        const cmd = functionDef.slashCommand;
        this.slashCommands.push({
          ...cmd,
          run: () => {
            return plug.invoke(name, [cmd]);
          },
        });
      }
    }
    for (const command of Object.values(
      this.client.config.get<Record<string, SlashCommand>>("slashCommands", {}),
    )) {
      this.slashCommands.push(command);
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
    // Pass -1 so we resolve into the node ending at the cursor: when typing,
    // the user is referring to preceding text, not what comes after.
    const currentNode = syntaxTree(ctx.state).resolveInner(ctx.pos, -1);
    if (
      currentNode.type.name === "CommentMarkerBlock" ||
      currentNode.type.name === "Link"
    ) {
      return null;
    }

    const parentNodes = this.client.extractParentNodes(ctx.state, currentNode);
    for (const def of this.slashCommands) {
      if (
        def.onlyContexts &&
        !def.onlyContexts.some((context) =>
          parentNodes.some((node) => node.startsWith(context)),
        )
      ) {
        continue;
      }
      if (
        def.exceptContexts?.some((context) =>
          parentNodes.some((node) => node.startsWith(context)),
        )
      ) {
        continue;
      }
      options.push({
        label: def.name,
        detail: def.description,
        boost: def.priority,
        apply: () => {
          this.client.editorView.dispatch({
            changes: {
              from: prefix!.from + prefixText.indexOf("/"),
              to: ctx.pos,
              insert: "",
            },
          });
          this.runSlash(async () => {
            await def.run!();
          });
        },
      });
    }

    const slashCompletions: CompletionResult | SlashCompletions | null =
      await this.client.completeWithEvent(ctx, "slash:complete");

    if (slashCompletions) {
      for (const slashCompletion of slashCompletions.options as SlashCompletionOption[]) {
        options.push({
          label: slashCompletion.label,
          detail: slashCompletion.detail,
          boost: slashCompletion.order && -slashCompletion.order,
          apply: () => {
            this.client.editorView.dispatch({
              changes: {
                from: prefix!.from + prefixText.indexOf("/"),
                to: ctx.pos,
                insert: "",
              },
            });
            this.runSlash(async () => {
              await this.client.clientSystem.system.invokeFunction(
                slashCompletion.invoke,
                [slashCompletion],
              );
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

  /**
   * Slash templates used to fail only in the browser console (`safeRun`),
   * matching https://github.com/silverbulletmd/silverbullet/issues/815.
   */
  private runSlash(fn: () => Promise<void>): void {
    safeRun(async () => {
      try {
        await fn();
        this.client.focus();
      } catch (e: any) {
        this.client.reportError(e, "slash command");
      }
    });
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
