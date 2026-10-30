import { beforeAll, describe, expect, test } from "vitest";
import { findManagedBlock } from "./config_block.ts";
import { applyManagedChanges, diffOverrides } from "./managed_edit.ts";
import { parseManagedBlock, toLua } from "./managed_lua.ts";

const MARKER = "-- managed-by: configuration-manager";

const setLine = (text: string, path: string, value: unknown) =>
  applyManagedChanges(text, { config: { set: { [path]: value }, unset: [] } });

describe("applyManagedChanges: setting one config value", () => {
  const PATH = "share.silverbullet.spaces";
  const VALUE = ["https://h/notes"];
  let LINE: string;
  beforeAll(() => {
    LINE = `config.set("${PATH}", ${toLua(VALUE)})`;
  });

  test("appends a line to an existing managed block", () => {
    const text = `Intro

\`\`\`space-lua
${MARKER}
config.set("a", 1)
command.update { name = "X", key = "Ctrl-x" }
\`\`\`
`;
    const result = setLine(text, PATH, VALUE);
    expect(result).toBe(`Intro

\`\`\`space-lua
${MARKER}
config.set("a", 1)
command.update { name = "X", key = "Ctrl-x" }
${LINE}
\`\`\`
`);
  });

  test("replaces the existing line for the same path", () => {
    const text = `\`\`\`space-lua
${MARKER}
config.set("a", 1)
config.set("${PATH}", { "old" })
config.set("${PATH}2", { "keep" })
config.set("b", 2)
\`\`\`
`;
    const result = setLine(text, PATH, VALUE);
    expect(result).toBe(`\`\`\`space-lua
${MARKER}
config.set("a", 1)
${LINE}
config.set("${PATH}2", { "keep" })
config.set("b", 2)
\`\`\`
`);
  });

  test("creates the managed block when none exists", () => {
    const text = "# Config\n\nSome text\n";
    const result = setLine(text, PATH, VALUE);
    expect(result.startsWith(text)).toBe(true);
    expect(findManagedBlock(result)!.innerContent).toBe(`${MARKER}\n${LINE}\n`);
  });

  test("setting a table value twice leaves one statement for the path", () => {
    const other = toLua({ k: ["x", "y"] });
    const text = `\`\`\`space-lua
${MARKER}
config.set("a", 1)
command.update { name = "X", key = "Ctrl-x" }
config.set("b", ${other})
\`\`\`
`;
    const once = setLine(text, PATH, ["a"]);
    const twice = setLine(once, PATH, ["b", "c"]);
    const inner = findManagedBlock(twice)!.innerContent;
    expect(inner.split(`config.set("${PATH}"`).length - 1).toBe(1);
    const parsed = parseManagedBlock(inner);
    expect(parsed.configOverrides).toEqual({
      a: 1,
      b: { k: ["x", "y"] },
      [PATH]: ["b", "c"],
    });
    expect(parsed.commandOverrides).toEqual({ X: { key: "Ctrl-x" } });
    expect(inner).toContain('config.set("a", 1)');
    expect(inner).toContain(`config.set("b", ${other})`);
  });

  test("does not touch a same-named config.set outside the managed block", () => {
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
    const result = setLine(text, PATH, VALUE);
    expect(result.startsWith(outside)).toBe(true);
    expect(findManagedBlock(result)!.innerContent).toContain(LINE);
    expect(result).toContain(`config.set("${PATH}", { "mine" })`);
  });

  test("tolerates comments and ignores config.set inside strings or comments", () => {
    const text = `\`\`\`space-lua
${MARKER}
-- config.set("${PATH}", { "commented" })
config.set("s", 'config.set("${PATH}", 1)')
config.set("${PATH}", { "old" }) -- trailing note
\`\`\`
`;
    const result = setLine(text, PATH, VALUE);
    expect(result).toBe(`\`\`\`space-lua
${MARKER}
-- config.set("${PATH}", { "commented" })
config.set("s", 'config.set("${PATH}", 1)')
${LINE} -- trailing note
\`\`\`
`);
  });

  test("refuses to edit a managed block that is not valid Lua", () => {
    const text = `\`\`\`space-lua
${MARKER}
config.set("a", {
\`\`\`
`;
    expect(() => setLine(text, PATH, VALUE)).toThrow(/not valid Lua/);
  });

  test("collapses duplicate statements for the path into one", () => {
    const text = `\`\`\`space-lua
${MARKER}
config.set("${PATH}", { "first" })
config.set("a", 1)
config.set("${PATH}", { "second" })
  config.set("${PATH}", { "third" }) -- trailing
config.set("b", 2)
\`\`\`
`;
    const result = setLine(text, PATH, VALUE);
    expect(result).toBe(`\`\`\`space-lua
${MARKER}
${LINE}
config.set("a", 1)
  -- trailing
config.set("b", 2)
\`\`\`
`);
  });

  test("removes a duplicate on the block's last line cleanly", () => {
    const text = `\`\`\`space-lua
${MARKER}
config.set("${PATH}", { "first" })
config.set("${PATH}", { "last" })
\`\`\`
`;
    const result = setLine(text, PATH, VALUE);
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

  test("unsets remove every statement for the path or command", () => {
    const text = block(
      'config.set("a", 1)',
      'command.update { name = "X", key = "Ctrl-x" }',
      'config.set("b", 2)',
      'config.set("a", 3)',
    );
    expect(
      applyManagedChanges(text, {
        config: { set: {}, unset: ["a"] },
        commands: { set: {}, unset: ["X"] },
      }),
    ).toBe(block('config.set("b", 2)'));
  });

  test("sets commands in place, or appends them", () => {
    const text = block(
      'command.update { name = "X", key = "Ctrl-x" }',
      "-- a note",
    );
    expect(
      applyManagedChanges(text, {
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

  test("removes the block once it holds only the marker", () => {
    const text = block('config.set("a", 1)');
    expect(
      applyManagedChanges(text, { config: { set: {}, unset: ["a"] } }),
    ).toBe("# Config\n");
    // Nothing to write and no block: unchanged
    expect(
      applyManagedChanges("# Config\n", {
        config: { set: {}, unset: ["a"] },
      }),
    ).toBe("# Config\n");
  });

  test("keeps a block that still holds comments", () => {
    const text = block("-- mine", 'config.set("a", 1)');
    expect(
      applyManagedChanges(text, { config: { set: {}, unset: ["a"] } }),
    ).toBe(block("-- mine"));
  });

  test("round-trips through parseManagedBlock", () => {
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

    const text = applyManagedChanges("", {
      config: { set: configOverrides, unset: [] },
      commands: { set: commandOverrides, unset: [] },
    });
    const parsed = parseManagedBlock(findManagedBlock(text)!.innerContent);
    expect(parsed.configOverrides).toEqual(configOverrides);
    expect(parsed.commandOverrides).toEqual(commandOverrides);
  });
});

describe("diffOverrides", () => {
  test("sets new and changed values, unsets missing ones", () => {
    expect(
      diffOverrides<unknown>(
        { same: ["a"], changed: { k: 1 }, dropped: true },
        { same: ["a"], changed: { k: 2 }, added: "x" },
      ),
    ).toEqual({ set: { changed: { k: 2 }, added: "x" }, unset: ["dropped"] });
  });

  test("never writes undefined, nor unsets a key that is still there", () => {
    expect(
      diffOverrides({ a: undefined }, { a: undefined, b: undefined }),
    ).toEqual({ set: {}, unset: [] });
  });
});
