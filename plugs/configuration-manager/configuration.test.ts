import { describe, expect, test } from "vitest";
import { findManagedBlock } from "./config_block.ts";
import { saveConfiguration } from "./configuration.ts";
import { parseManagedBlock } from "./lua.ts";
import { installTestSyscalls } from "./test_syscalls.ts";
import { buildSchemaIndex, configChanges } from "./ui/schema.ts";
import type { ConfigurationViewModel } from "./ui/types.ts";

const syscalls = installTestSyscalls();

const MARKER = "-- managed-by: configuration-manager";

function stubSpace(configText: string): string[] {
  const written: string[] = [];
  syscalls["space.readPage"] = () => configText;
  syscalls["space.writePage"] = (_name: string, text: string) => {
    written.push(text);
  };
  for (const name of [
    "sync.performFileSync",
    "mq.send",
    "mq.awaitEmptyQueue",
    "editor.reloadConfigAndCommands",
    "editor.rebuildEditorState",
  ]) {
    syscalls[name] = () => {};
  }
  return written;
}

describe("saveConfiguration", () => {
  test("rewrites a valid managed block", async () => {
    const written = stubSpace(
      `# Config\n\n\`\`\`space-lua\n${MARKER}\nconfig.set("a", 1)\n\`\`\`\n`,
    );
    await saveConfiguration({ config: { set: { a: 2 }, unset: [] } });
    expect(written).toHaveLength(1);
    expect(written[0]).toContain(
      `# Config\n\n\`\`\`space-lua\n${MARKER}\nconfig.set("a", 2)\n\`\`\``,
    );
  });

  test("refuses to replace a managed block that is not valid Lua", async () => {
    const written = stubSpace(
      `\`\`\`space-lua\n${MARKER}\nconfig.set("a", 1)\nconfig.set("b", {\n\`\`\`\n`,
    );
    await expect(
      saveConfiguration({ config: { set: { c: true }, unset: [] } }),
    ).rejects.toThrow(/not valid Lua/);
    expect(written).toEqual([]);
  });

  test("keeps overrides the UI has no field for, even when changed meanwhile", async () => {
    const configText = `\`\`\`space-lua
${MARKER}
config.set("share.silverbullet.spaces", {
  "https://h/a",
  "https://h/b",
})
config.set("shortWikiLinks", false)
\`\`\`
`;
    // What the configuration UI does: open, change one field, save...
    const { configOverrides } = await parseManagedBlock(
      findManagedBlock(configText)!.innerContent,
    );
    // ...while Share remembers another space in the meantime
    const written = stubSpace(
      configText.replace('"https://h/a",', '"https://h/c",\n  "https://h/a",'),
    );
    const index = buildSchemaIndex({
      schemas: {
        type: "object",
        properties: {
          shortWikiLinks: {
            type: "boolean",
            ui: { category: "Editor", label: "Short wiki links" },
          },
          share: {
            type: "object",
            properties: {
              silverbullet: {
                type: "object",
                properties: { spaces: { type: "array" } },
              },
            },
          },
        },
      },
      values: {},
      categories: {},
      configOverrides,
    } as unknown as ConfigurationViewModel);
    const pending = { ...index.initialConfig, shortWikiLinks: true };
    await saveConfiguration({
      config: configChanges(
        configOverrides,
        new Set(index.initialModifiedPaths),
        pending,
      ),
      commands: { set: {}, unset: [] },
    });
    const saved = await parseManagedBlock(
      findManagedBlock(written[0])!.innerContent,
    );
    expect(saved.configOverrides).toEqual({
      "share.silverbullet.spaces": [
        "https://h/c",
        "https://h/a",
        "https://h/b",
      ],
      shortWikiLinks: true,
    });
  });

  test("writes only what changed, and drops reset overrides", async () => {
    const written = stubSpace(
      `\`\`\`space-lua\n${MARKER}\nconfig.set("a", 1) -- mine\nconfig.set("b", 2)\ncommand.update { name = "X", key = "Ctrl-x" }\n\`\`\`\n`,
    );
    const initial = { a: 1, b: 2 };
    await saveConfiguration({
      // a untouched, b reset, c new
      config: configChanges(initial, new Set(["a", "c"]), { a: 1, c: 3 }),
      commands: { set: {}, unset: ["X"] },
    });
    expect(written[0]).toBe(
      `\`\`\`space-lua\n${MARKER}\nconfig.set("a", 1) -- mine\nconfig.set("c", 3)\n\`\`\`\n`,
    );
  });
});
