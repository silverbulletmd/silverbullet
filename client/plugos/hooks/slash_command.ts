import type {
  Completion,
  CompletionContext,
  CompletionResult,
} from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { safeRun, throttle } from "@silverbulletmd/silverbullet/lib/async";
import type {
  SlashCompletionOption,
  SlashCompletions,
} from "@silverbulletmd/silverbullet/type/client";
import type {
  SlashCommandDef,
  SlashCommandHookT,
} from "@silverbulletmd/silverbullet/type/manifest";
import type { Client } from "../../client.ts";
import { contextsAt, matchesNodeContexts } from "../../lib/node_contexts.ts";
import type { SlashCommand } from "../../types/command.ts";
import type { System } from "../system.ts";
import type { Hook, Manifest } from "../types.ts";

const slashCommandRegexp = /([^\w:]|^)\/[\w#-]*/;

/**
 * The slash menu's sections (a command's `group`), in the order shown.
 * Commands without a group are listed under "Other"; groups not listed here
 * come right before "Other", alphabetically.
 */
export const SLASH_GROUPS = [
  "Basic blocks",
  "Lists",
  "Callouts",
  "Media",
  "Insert",
  "Dates",
  "Other",
  "Advanced",
  "Space Lua",
] as const;

const OTHER_GROUP = "Other";

/** Where `group` sorts in the menu; lower is earlier */
function slashGroupRank(group: string | undefined): number {
  const index = (SLASH_GROUPS as readonly string[]).indexOf(
    slashGroupName(group),
  );
  // Unknown groups: just before "Other" (ties sort by name)
  return index === -1 ? SLASH_GROUPS.indexOf(OTHER_GROUP) - 0.5 : index;
}

/**
 * How well `query` (what's typed after `/`) matches a command, on its name,
 * display name and aliases: higher is better, null is no match. An empty
 * query matches everything.
 */
export function slashMatchScore(
  def: Pick<SlashCommandDef, "name" | "displayName" | "aliases">,
  query: string,
): number | null {
  if (query === "") return 0;
  const q = query.toLowerCase();
  // [key, is the name, fuzzy matched (as CodeMirror did on the name)]
  const keys: [string | undefined, boolean, boolean][] = [
    [def.name, true, true],
    [def.displayName, false, true],
    ...(def.aliases ?? []).map((alias): [string, boolean, boolean] => [
      alias,
      false,
      false,
    ]),
  ];
  let best: number | null = null;
  const consider = (score: number) => {
    if (best === null || score > best) best = score;
  };
  for (const [rawKey, isName, fuzzy] of keys) {
    if (!rawKey) continue;
    const key = rawKey.toLowerCase();
    // The name itself wins ties: `/query` is still the `query` command
    const bonus = isName ? 1 : 0;
    if (key === q) consider(100 + bonus);
    else if (key.startsWith(q)) consider(80 + bonus);
    else if (key.split(/[\s\-_:./…]+/).some((word) => word.startsWith(q))) {
      consider(60 + bonus);
    } else if (key.includes(q)) consider(40 + bonus);
    else if (fuzzy && isSubsequence(q, key)) consider(20 + bonus);
  }
  return best;
}

function isSubsequence(needle: string, haystack: string): boolean {
  let at = 0;
  for (const char of haystack) {
    if (char === needle[at]) at++;
    if (at === needle.length) return true;
  }
  return false;
}

/** One row of the slash menu, before it becomes a CodeMirror completion */
export type SlashMenuEntry = {
  label: string;
  description?: string;
  icon?: string;
  group?: string;
  priority?: number;
  /** From `slashMatchScore` */
  score: number;
  apply: () => void;
};

/** The section an entry with `group` is listed under */
export function slashGroupName(group: string | undefined): string {
  return group || OTHER_GROUP;
}

/**
 * The slash menu's order. With nothing typed (`filtering` false): by group,
 * then priority, then label. While filtering: best match first, then the same.
 */
export function sortSlashEntries(
  entries: SlashMenuEntry[],
  filtering: boolean,
): SlashMenuEntry[] {
  return [...entries].sort(
    (a, b) =>
      (filtering ? b.score - a.score : 0) ||
      slashGroupRank(a.group) - slashGroupRank(b.group) ||
      slashGroupName(a.group).localeCompare(slashGroupName(b.group)) ||
      (b.priority ?? 0) - (a.priority ?? 0) ||
      a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
  );
}

/**
 * The menu's completions, in order. With nothing typed: by group (with a
 * header per group), then priority, then label. While filtering: best match
 * first, then the same order, without headers.
 */
export function slashMenuOptions(
  entries: SlashMenuEntry[],
  filtering: boolean,
): (Completion & { slashIcon?: string })[] {
  return sortSlashEntries(entries, filtering).map((entry) => {
    const group = slashGroupName(entry.group);
    return {
      label: entry.label,
      detail: entry.description,
      slashIcon: entry.icon,
      section: filtering
        ? undefined
        : { name: group, rank: slashGroupRank(entry.group) },
      apply: entry.apply,
    };
  });
}

/**
 * The contexts a slash command is filtered on: those at the `/`, as if the
 * typed `/query` (`slashFrom`–`pos`) weren't there, so `@blank` means the
 * line was blank before typing `/` (and the `/` doesn't open a paragraph).
 */
export function slashContextsAt(
  client: Pick<Client, "extractParentNodes">,
  state: EditorState,
  slashFrom: number,
  pos: number,
): string[] {
  if (slashFrom === pos) return contextsAt(client, state, slashFrom);
  const without = state.update({
    changes: { from: slashFrom, to: pos, insert: "" },
  }).state;
  return contextsAt(client, without, slashFrom);
}

export class SlashCommandHook implements Hook<SlashCommandHookT> {
  slashCommands: SlashCommand[] = [];
  /** Commands the client itself provides, listed before plugs' and config's */
  private builtins: SlashCommand[] = [];
  throttledBuildAllCommands = throttle(() => {
    this.buildAllCommands();
  }, 200);

  constructor(private client: Client) {}

  /** Registers `cmd`; it's listed from the next build (the hook builds when applied) */
  addBuiltin(cmd: SlashCommand): void {
    this.builtins.push(cmd);
  }

  buildAllCommands() {
    const clientSystem = this.client.clientSystem;
    const system = clientSystem.system;

    this.slashCommands = [...this.builtins];
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

  /**
   * The slash commands offered where `/query` is typed (`slashFrom`–`pos`),
   * matching `query`, as unordered menu entries. Picking one calls `before`
   * (which removes the typed text in the menu), then runs the command. Also
   * what a blank line's ⋮ menu offers (`slashFrom` = `pos`, nothing typed).
   */
  entriesAt(
    state: EditorState,
    slashFrom: number,
    pos: number,
    {
      query = "",
      before = () => {},
    }: { query?: string; before?: () => void } = {},
  ): SlashMenuEntry[] {
    const entries: SlashMenuEntry[] = [];
    const parentNodes = slashContextsAt(this.client, state, slashFrom, pos);
    for (const def of this.slashCommands) {
      if (!matchesNodeContexts(def, parentNodes)) {
        continue;
      }
      const score = slashMatchScore(def, query);
      if (score === null) {
        continue;
      }
      entries.push({
        label: def.displayName || def.name,
        description: def.description,
        icon: def.icon,
        group: def.group,
        priority: def.priority,
        score,
        apply: () => {
          before();
          safeRun(async () => {
            await def.run!();
            this.client.focus();
          });
        },
      });
    }
    return entries;
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
    const slashFrom = prefix.from + prefixText.indexOf("/");
    const query = ctx.state.sliceDoc(slashFrom + 1, ctx.pos);

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

    // Deletes the typed `/query` (the command runs where it was typed)
    const removeQuery = () => {
      this.client.editorView.dispatch({
        changes: { from: slashFrom, to: ctx.pos, insert: "" },
      });
    };

    const entries = this.entriesAt(ctx.state, slashFrom, ctx.pos, {
      query,
      before: removeQuery,
    });

    const slashCompletions: CompletionResult | SlashCompletions | null =
      await this.client.completeWithEvent(ctx, "slash:complete");

    if (slashCompletions) {
      for (const slashCompletion of slashCompletions.options as SlashCompletionOption[]) {
        const score = slashMatchScore({ name: slashCompletion.label }, query);
        if (score === null) {
          continue;
        }
        entries.push({
          label: slashCompletion.label,
          description: slashCompletion.detail,
          priority: slashCompletion.order && -slashCompletion.order,
          score,
          apply: () => {
            removeQuery();
            safeRun(async () => {
              await this.client.clientSystem.system.invokeFunction(
                slashCompletion.invoke,
                [slashCompletion],
              );
              this.client.focus();
            });
          },
        });
      }
    }

    return {
      // + 1 because of the '/'
      from: slashFrom + 1,
      // Matched and ordered here: on name, display name and aliases
      filter: false,
      options: slashMenuOptions(entries, query !== ""),
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
