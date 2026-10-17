import { describe, expect, test } from "vitest";
import type { SlashCommand } from "../../types/command.ts";
import { SlashCommandHook } from "./slash_command.ts";

function stubClient(configured: Record<string, SlashCommand> = {}) {
  return {
    clientSystem: { system: { loadedPlugs: new Map() } },
    config: {
      get: (_key: string, fallback: unknown) => configured ?? fallback,
    },
  } as any;
}

const builtin: SlashCommand = {
  name: "Query…",
  description: "Build a query in the Workbench and insert it here",
  run: async () => ({ options: [] }) as any,
};

describe("SlashCommandHook built-ins", () => {
  test("a built-in is listed first, even with no plugs loaded", () => {
    const hook = new SlashCommandHook(
      stubClient({ hr: { name: "hr", run: async () => ({}) as any } as any }),
    );
    hook.addBuiltin(builtin);
    hook.buildAllCommands();
    expect(hook.slashCommands.map((c) => c.name)).toEqual(["Query…", "hr"]);
  });

  test("built-ins survive a rebuild", () => {
    const hook = new SlashCommandHook(stubClient());
    hook.addBuiltin(builtin);
    hook.buildAllCommands();
    expect(hook.slashCommands).toContain(builtin);
  });
});
