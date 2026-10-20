import { beforeAll, describe, expect, test } from "vitest";
import { findManagedBlock } from "./config_block.ts";
import { parseManagedBlock, toLua } from "./lua.ts";
import { applyManagedChanges } from "./managed_edit.ts";
import { installTestSyscalls } from "./test_syscalls.ts";

installTestSyscalls();

const MARKER = "-- managed-by: configuration-manager";

const setLine = (text: string, path: string, value: unknown) =>
  applyManagedChanges(text, { config: { set: { [path]: value }, unset: [] } });

describe("applyManagedChanges: setting one config value", () => {
  const PATH = "share.silverbullet.spaces";
  const VALUE = ["https://h/notes"];
  let LINE: string;
  beforeAll(async () => {
    LINE = `config.set("${PATH}", ${await toLua(VALUE)})`;
  });

  test("appends a line to an existing managed block", async () => {
    const text = `Intro

\`\`\`space-lua
${MARKER}
config.set("a", 1)
command.update { name = "X", key = "Ctrl-x" }
\`\`\`
`;
    const result = await setLine(text, PATH, VALUE);
    expect(result).toBe(`Intro

\`\`\`space-lua
${MARKER}
config.set("a", 1)
command.update { name = "X", key = "Ctrl-x" }
${LINE}
\`\`\`
`);
  });

  test("replaces the existing line for the same path", async () => {
    const text = `\`\`\`space-lua
${MARKER}
config.set("a", 1)
config.set("${PATH}", { "old" })
config.set("${PATH}2", { "keep" })
config.set("b", 2)
\`\`\`
`;
    const result = await setLine(text, PATH, VALUE);
    expect(result).toBe(`\`\`\`space-lua
${MARKER}
config.set("a", 1)
${LINE}
config.set("${PATH}2", { "keep" })
config.set("b", 2)
\`\`\`
`);
  });

  test("creates the managed block when none exists", async () => {
    const text = "# Config\n\nSome text\n";
    const result = await setLine(text, PATH, VALUE);
    expect(result.startsWith(text)).toBe(true);
    expect(findManagedBlock(result)!.innerContent).toBe(`${MARKER}\n${LINE}\n`);
  });

  test("setting a table value twice leaves one statement for the path", async () => {
    const other = await toLua({ k: ["x", "y"] });
    const text = `\`\`\`space-lua
${MARKER}
config.set("a", 1)
command.update { name = "X", key = "Ctrl-x" }
config.set("b", ${other})
\`\`\`
`;
    const once = await setLine(text, PATH, ["a"]);
    const twice = await setLine(once, PATH, ["b", "c"]);
    const inner = findManagedBlock(twice)!.innerContent;
    expect(inner.split(`config.set("${PATH}"`).length - 1).toBe(1);
    const parsed = await parseManagedBlock(inner);
    expect(parsed.configOverrides).toEqual({
      a: 1,
      b: { k: ["x", "y"] },
      [PATH]: ["b", "c"],
    });
    expect(parsed.commandOverrides).toEqual({ X: { key: "Ctrl-x" } });
    expect(inner).toContain('config.set("a", 1)');
    expect(inner).toContain(`config.set("b", ${other})`);
  });

  test("does not touch a same-named config.set outside the managed block", async () => {
    const outside = `\`\`\`space-lua
config.set("${PATH}", { "mine" })
\`\`\`
`;
    const text = `${outside}
\`\`\`space-lua
${MARKER}
config.set("a", 1)
\`\`\`
`;
    const result = await setLine(text, PATH, VALUE);
    expect(result.startsWith(outside)).toBe(true);
    expect(findManagedBlock(result)!.innerContent).toContain(LINE);
    expect(result).toContain(`config.set("${PATH}", { "mine" })`);
  });

  test("tolerates comments and ignores config.set inside strings or comments", async () => {
    const text = `\`\`\`space-lua
${MARKER}
-- config.set("${PATH}", { "commented" })
config.set("s", 'config.set("${PATH}", 1)')
config.set("${PATH}", { "old" }) -- trailing note
\`\`\`
`;
    const result = await setLine(text, PATH, VALUE);
    expect(result).toBe(`\`\`\`space-lua
${MARKER}
-- config.set("${PATH}", { "commented" })
config.set("s", 'config.set("${PATH}", 1)')
${LINE} -- trailing note
\`\`\`
`);
  });

  test("refuses to edit a managed block that is not valid Lua", async () => {
    const text = `\`\`\`space-lua
${MARKER}
config.set("a", {
\`\`\`
`;
    await expect(setLine(text, PATH, VALUE)).rejects.toThrow(/not valid Lua/);
  });

  test("collapses duplicate statements for the path into one", async () => {
    const text = `\`\`\`space-lua
${MARKER}
config.set("${PATH}", { "first" })
config.set("a", 1)
config.set("${PATH}", { "second" })
  config.set("${PATH}", { "third" }) -- trailing
config.set("b", 2)
\`\`\`
`;
    const result = await setLine(text, PATH, VALUE);
    expect(result).toBe(`\`\`\`space-lua
${MARKER}
${LINE}
config.set("a", 1)
  -- trailing
config.set("b", 2)
\`\`\`
`);
  });

  test("removes a duplicate on the block's last line cleanly", async () => {
    const text = `\`\`\`space-lua
${MARKER}
config.set("${PATH}", { "first" })
config.set("${PATH}", { "last" })
\`\`\`
`;
    const result = await setLine(text, PATH, VALUE);
    expect(result).toBe(`\`\`\`space-lua
${MARKER}
${LINE}
\`\`\`
`);
  });
});

describe("applyManagedChanges", () => {
  const block = (...lines: string[]) =>
    `# Config\n\n\`\`\`space-lua\n${[MARKER, ...lines].join("\n")}\n\`\`\`\n`;

  test("unsets remove every statement for the path or command", async () => {
    const text = block(
      'config.set("a", 1)',
      'command.update { name = "X", key = "Ctrl-x" }',
      'config.set("b", 2)',
      'config.set("a", 3)',
    );
    expect(
      await applyManagedChanges(text, {
        config: { set: {}, unset: ["a"] },
        commands: { set: {}, unset: ["X"] },
      }),
    ).toBe(block('config.set("b", 2)'));
  });

  test("sets commands in place, or appends them", async () => {
    const text = block(
      'command.update { name = "X", key = "Ctrl-x" }',
      "-- a note",
    );
    expect(
      await applyManagedChanges(text, {
        commands: {
          set: { X: { key: "Ctrl-y" }, Y: { key: "Alt-y", mac: ["Cmd-y"] } },
          unset: [],
        },
      }),
    ).toBe(
      block(
        'command.update { name = "X", key = "Ctrl-y" }',
        "-- a note",
        'command.update { name = "Y", key = "Alt-y", mac = {"Cmd-y"} }',
      ),
    );
  });

  test("removes the block once it holds only the marker", async () => {
    const text = block('config.set("a", 1)');
    expect(
      await applyManagedChanges(text, { config: { set: {}, unset: ["a"] } }),
    ).toBe("# Config\n");
    // Nothing to write and no block: unchanged
    expect(
      await applyManagedChanges("# Config\n", {
        config: { set: {}, unset: ["a"] },
      }),
    ).toBe("# Config\n");
  });

  test("keeps a block that still holds comments", async () => {
    const text = block("-- mine", 'config.set("a", 1)');
    expect(
      await applyManagedChanges(text, { config: { set: {}, unset: ["a"] } }),
    ).toBe(block("-- mine"));
  });

  test("round-trips through parseManagedBlock", async () => {
    const configOverrides = {
      shortWikiLinks: false,
      "smartQuotes.enabled": true,
      autoCloseBrackets: "([{",
    };
    const commandOverrides: Record<
      string,
      { key?: string | string[]; mac?: string | string[] }
    > = {
      "Some: Command": { key: "Ctrl-x", mac: "Cmd-x" },
      "Chord Cmd": { key: "Ctrl-x Ctrl-s", mac: "Cmd-x Cmd-s" },
      "Array Cmd": { key: ["Ctrl-y", "Ctrl-Y"] },
      Other: { key: "Ctrl-y" },
    };

    const text = await applyManagedChanges("", {
      config: { set: configOverrides, unset: [] },
      commands: { set: commandOverrides, unset: [] },
    });
    const parsed = await parseManagedBlock(
      findManagedBlock(text)!.innerContent,
    );
    expect(parsed.configOverrides).toEqual(configOverrides);
    expect(parsed.commandOverrides).toEqual(commandOverrides);
  });
});
