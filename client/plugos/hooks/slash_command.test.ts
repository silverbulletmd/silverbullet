import { readFileSync } from "node:fs";
import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { beforeAll, describe, expect, test } from "vitest";
import { loadConfig } from "../../boot_config.ts";
import { buildExtendedMarkdownLanguage } from "../../markdown_parser/parser.ts";
import { extractSpaceLuaFromPageText } from "../../space_lua_blocks_test_util.ts";
import type { SlashCommand } from "../../types/command.ts";
import {
  SLASH_GROUPS,
  SlashCommandHook,
  type SlashMenuEntry,
  slashContextsAt,
  slashMatchScore,
  slashMenuOptions,
} from "./slash_command.ts";

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

test("slash commands filter on the markup bar's pseudo-contexts too", async () => {
  const client = {
    ...stubClient(),
    completeWithEvent: async () => null,
    // As Client.extractParentNodes, minus the code bodies
    extractParentNodes(_state: EditorState, node: SyntaxNode) {
      const names: string[] = [];
      for (let n: SyntaxNode | null = node; n; n = n.parent) names.push(n.name);
      return names;
    },
  };
  const hook = new SlashCommandHook(client);
  const run = async () => ({}) as any;
  hook.addBuiltin({ name: "fold", onlyContexts: ["@hasChildren"], run });
  hook.addBuiltin({ name: "leaf", exceptContexts: ["@hasChildren"], run });
  hook.buildAllCommands();
  const offered = async (doc: string) => {
    const state = EditorState.create({
      doc,
      extensions: [buildExtendedMarkdownLanguage()],
    });
    const pos = doc.indexOf("/") + 1;
    const result = await hook.slashCommandCompleter(
      new CompletionContext(state, pos, true),
    );
    return result?.options.map((o) => o.label);
  };
  expect(await offered("- a /\n  - b")).toEqual(["fold"]);
  expect(await offered("- a /\n- b")).toEqual(["leaf"]);
});

describe("matching on name, display name and aliases", () => {
  const heading = {
    name: "h1",
    displayName: "Heading 1",
    aliases: ["heading", "title"],
  };

  test("the typed name still matches, best of all", () => {
    expect(slashMatchScore(heading, "h1")).toBeGreaterThan(
      slashMatchScore(heading, "head")!,
    );
  });

  test("the display name and aliases match by prefix, any word, or substring", () => {
    expect(slashMatchScore(heading, "head")).not.toBeNull();
    expect(slashMatchScore(heading, "HEADING")).not.toBeNull();
    expect(slashMatchScore(heading, "tit")).not.toBeNull();
    expect(
      slashMatchScore({ name: "bullet", displayName: "Bulleted list" }, "list"),
    ).not.toBeNull();
    expect(slashMatchScore(heading, "quote")).toBeNull();
  });

  test("abbreviations of the name still match, as CodeMirror's fuzzy matching did", () => {
    expect(slashMatchScore({ name: "note-admonition" }, "nadm")).not.toBeNull();
    // Not of an alias: those match as words only
    expect(slashMatchScore({ name: "x", aliases: ["callout"] }, "clt")).toBe(
      null,
    );
  });

  test("on a tie the command's own name wins over another's alias", () => {
    const raw = { name: "query", displayName: "Query (code)" };
    const wizard = { name: "Query…", aliases: ["query"] };
    expect(slashMatchScore(raw, "query")).toBeGreaterThan(
      slashMatchScore(wizard, "query")!,
    );
  });

  test("nothing typed matches everything", () => {
    expect(slashMatchScore(heading, "")).toBe(0);
  });
});

describe("menu order and groups", () => {
  const entry = (
    label: string,
    group?: string,
    priority?: number,
    score = 0,
  ): SlashMenuEntry => ({ label, group, priority, score, apply: () => {} });
  const entries = [
    entry("Today", "Dates", 3),
    entry("Mine"),
    entry("Space Lua block", "Advanced", 10),
    entry("Custom thing", "Custom"),
    entry("Bulleted list", "Lists", 30),
    entry("Heading 2", "Basic blocks", 93),
    entry("Heading 1", "Basic blocks", 94),
    entry("Table", "Basic blocks"),
    entry("Callout: note", "Callouts", 40),
  ];

  test("the group order is fixed, Basic blocks first", () => {
    expect(SLASH_GROUPS.slice(0, 3)).toEqual([
      "Basic blocks",
      "Lists",
      "Callouts",
    ]);
  });

  test("with nothing typed: by group, then priority, then label, with a header per group", () => {
    const options = slashMenuOptions(entries, false);
    expect(options.map((o) => o.label)).toEqual([
      "Heading 1",
      "Heading 2",
      "Table",
      "Bulleted list",
      "Callout: note",
      "Today",
      // Unknown groups come just before Other, which has the ungrouped ones
      "Custom thing",
      "Mine",
      "Space Lua block",
    ]);
    expect(options.map((o) => (o.section as { name: string }).name)).toEqual([
      "Basic blocks",
      "Basic blocks",
      "Basic blocks",
      "Lists",
      "Callouts",
      "Dates",
      "Custom",
      "Other",
      "Advanced",
    ]);
    // CodeMirror orders sections by rank
    const ranks = options.map((o) => (o.section as { rank: number }).rank);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
  });

  test("while filtering: best match first, without headers", () => {
    const options = slashMenuOptions(
      [
        entry("Heading 1", "Basic blocks", 94, 20),
        entry("Divider", "Basic blocks", 50, 101),
      ],
      true,
    );
    expect(options.map((o) => o.label)).toEqual(["Divider", "Heading 1"]);
    expect(options.every((o) => o.section === undefined)).toBe(true);
  });
});

describe("@blank ignores the typed /query", () => {
  const parentNames = {
    extractParentNodes(_state: EditorState, node: SyntaxNode) {
      const names: string[] = [];
      for (let n: SyntaxNode | null = node; n; n = n.parent) names.push(n.name);
      return names;
    },
  };
  const contextsFor = (doc: string) => {
    const state = EditorState.create({
      doc,
      extensions: [buildExtendedMarkdownLanguage()],
    });
    const slash = doc.lastIndexOf("/");
    const end = doc.indexOf("\n", slash);
    return slashContextsAt(
      parentNames,
      state,
      slash,
      end === -1 ? doc.length : end,
    );
  };

  test("a line with only /query is blank", () => {
    expect(contextsFor("one\n\n/quer\n\nthree")).toContain("@blank");
    expect(contextsFor("/")).toContain("@blank");
    expect(contextsFor("one /quer")).not.toContain("@blank");
  });

  test("the / doesn't continue the list item above it", () => {
    expect(contextsFor("- item\n/h")).not.toContain("ListItem");
    expect(contextsFor("- item /h")).toContain("ListItem");
  });
});

/** The Std library's slash commands, as Space Lua defines them */
async function stdSlashCommands(): Promise<Record<string, SlashCommand>> {
  const lua = [
    "libraries/Library/Std/APIs/Schema.md",
    "libraries/Library/Std/Config.md",
    "libraries/Library/Std/APIs/Command.md",
    "libraries/Library/Std/Slash Commands/Slash.md",
    "libraries/Library/Std/APIs/Date.md",
    "libraries/Library/Std/Editor/Signature.md",
  ]
    .map((path) => extractSpaceLuaFromPageText(readFileSync(path, "utf8")))
    .join("\n");
  const config = await loadConfig([{ ref: "std", code: lua }], {}, false);
  return config.get("slashCommands", {});
}

describe("the Std slash menu", () => {
  let hook: SlashCommandHook;
  beforeAll(async () => {
    const commands = await stdSlashCommands();
    hook = new SlashCommandHook({
      ...stubClient(commands),
      completeWithEvent: async () => null,
      extractParentNodes(state: EditorState, node: SyntaxNode) {
        const names: string[] = [];
        for (let n: SyntaxNode | null = node; n; n = n.parent) {
          // As Client.extractParentNodes: code blocks with their language
          names.push(
            n.name === "FencedCode" || n.name === "FrontMatter"
              ? `${n.name}:${state.sliceDoc(n.from + 3, n.to - 3)}`
              : n.name,
          );
        }
        return names;
      },
    } as any);
    hook.buildAllCommands();
  });

  /** The menu where `|` is, as labels */
  const menu = async (docWithCursor: string) => {
    const pos = docWithCursor.indexOf("|");
    const doc = docWithCursor.replace("|", "");
    const state = EditorState.create({
      doc,
      extensions: [buildExtendedMarkdownLanguage()],
    });
    const result = await hook.slashCommandCompleter(
      new CompletionContext(state, pos, true),
    );
    return result?.options ?? [];
  };
  const labels = async (doc: string) => (await menu(doc)).map((o) => o.label);

  test("on a blank line: Basic blocks first, by display name", async () => {
    const options = await menu("Intro\n\n/|");
    expect((options[0].section as { name: string }).name).toBe("Basic blocks");
    expect(options.slice(0, 5).map((o) => o.label)).toEqual([
      "Heading 1",
      "Heading 2",
      "Heading 3",
      "Heading 4",
      "Quote",
    ]);
    const all = options.map((o) => o.label);
    for (const label of [
      "Bulleted list",
      "Numbered list",
      "Task",
      "Image or file",
      "Embed page",
      "Link to page",
      "Tag",
      "Page properties",
      "Today",
      "Space Lua block",
    ]) {
      expect(all).toContain(label);
    }
    // Turning an empty line into text does nothing: not offered
    expect(all).not.toContain("Text");
  });

  test("display names and aliases find them too", async () => {
    // The old names still find them first
    expect((await labels("/h1|"))[0]).toBe("Heading 1");
    expect((await labels("/task|"))[0]).toBe("Task");
    expect((await labels("/today|"))[0]).toBe("Today");
    expect((await labels("/space-lua|"))[0]).toBe("Space Lua block");
    expect((await labels("/heading|"))[0]).toBe("Heading 1");
    expect(await labels("/todo|")).toContain("Task");
    expect(await labels("/date|")).toEqual(["Today", "Tomorrow", "Yesterday"]);
    expect(await labels("/list|")).toEqual(["Bulleted list", "Numbered list"]);
  });

  test("Text is offered where there's block markup to strip", async () => {
    expect(await labels("## Title /|")).toContain("Text");
    expect(await labels("- item /|")).toContain("Text");
    expect(await labels("Plain /|")).not.toContain("Text");
  });

  test("no prose blocks in code or frontmatter", async () => {
    for (const doc of ["```\n/|\n```", "---\ntitle: /|\n---\n"]) {
      const all = await labels(doc);
      for (const label of ["Heading 1", "Task", "Today", "Bulleted list"]) {
        expect(all).not.toContain(label);
      }
    }
  });

  test("a list item isn't offered headings, lists or a quote", async () => {
    const all = await labels("- item /|");
    for (const label of ["Heading 1", "Bulleted list", "Quote"]) {
      expect(all).not.toContain(label);
    }
    // A task is
    expect(all).toContain("Task");
    expect(await labels("- [ ] task /|")).not.toContain("Task");
    // The line below a list item, with just the /, is no list item
    expect(await labels("- item\n/|")).toContain("Heading 1");
  });

  test("Page properties only on a page without frontmatter", async () => {
    expect(await labels("Body\n/|")).toContain("Page properties");
    expect(await labels("---\ntags: x\n---\nBody\n/|")).not.toContain(
      "Page properties",
    );
  });
});

describe("running the Std slash commands", () => {
  /**
   * The Std slash commands, bound to an editor holding `docWithCursor` (`|`
   * is the cursor, after the typed /query was removed)
   */
  async function editorWith(docWithCursor: string) {
    const anchor = docWithCursor.indexOf("|");
    const editor = {
      state: EditorState.create({
        doc: docWithCursor.replace("|", ""),
        selection: { anchor },
      }),
      dispatch(spec: any) {
        editor.state = editor.state.update(spec).state;
      },
      focus() {},
    };
    const invoked: string[] = [];
    const client = {
      editorView: editor,
      runCommandByName: async (name: string) => {
        invoked.push(name);
      },
    };
    const lua = [
      "libraries/Library/Std/APIs/Schema.md",
      "libraries/Library/Std/Config.md",
      "libraries/Library/Std/APIs/Command.md",
      "libraries/Library/Std/Slash Commands/Slash.md",
    ]
      .map((path) => extractSpaceLuaFromPageText(readFileSync(path, "utf8")))
      .join("\n");
    const config = await loadConfig([{ ref: "std", code: lua }], client, false);
    const commands = config.get<Record<string, SlashCommand>>(
      "slashCommands",
      {},
    );
    return {
      run: (name: string) => commands[name].run(),
      invoked,
      /** The document, `|` at the cursor */
      text: () => {
        const head = editor.state.selection.main.head;
        const doc = editor.state.doc.toString();
        return `${doc.slice(0, head)}|${doc.slice(head)}`;
      },
    };
  }

  test("Text strips heading, list, task and quote markup", async () => {
    for (const [before, after] of [
      // Without the space typed before the `/`
      ["## Title |", "Title|"],
      ["- [ ] task|", "task|"],
      ["  1. item|", "item|"],
      ["> - quoted|", "quoted|"],
    ]) {
      const editor = await editorWith(before);
      await editor.run("text");
      expect(editor.text()).toBe(after);
    }
  });

  test("headings and lists run the line menu's Turn into commands", async () => {
    const editor = await editorWith("Some text |");
    await editor.run("h2");
    await editor.run("bullet");
    await editor.run("task");
    expect(editor.invoked).toEqual([
      "Text: Heading 2",
      "Text: Listify Selection",
      "Text: Taskify Line",
    ]);
    // The space typed before the `/` is gone
    expect(editor.text()).toBe("Some text|");
  });

  test("a block on a line with text goes below it, as a block of its own", async () => {
    const editor = await editorWith("Some text |\nNext");
    await editor.run("space-lua");
    expect(editor.text()).toBe("Some text\n\n```space-lua\n|\n```\n\nNext");
  });

  test("a block on an empty line goes there, apart from the text after it", async () => {
    const editor = await editorWith("Intro\n|\nNext");
    await editor.run("space-lua");
    expect(editor.text()).toBe("Intro\n```space-lua\n|\n```\n\nNext");
  });

  test("Embed page and Tag type their trigger, ready to complete", async () => {
    const embed = await editorWith("See |");
    await embed.run("embed");
    expect(embed.text()).toBe("See ![[|]]");
    const tag = await editorWith("Filed |");
    await tag.run("tag");
    expect(tag.text()).toBe("Filed #|");
  });
});

test("a callout template turns the line into a callout (slashCommand.convertLine)", async () => {
  const anchor = "Remember this|".indexOf("|");
  const editor = {
    state: EditorState.create({
      doc: "Remember this\nNext",
      selection: { anchor },
    }),
    dispatch(spec: any) {
      editor.state = editor.state.update(spec).state;
    },
    focus() {},
  };
  const lua = [
    "libraries/Library/Std/APIs/Schema.md",
    "libraries/Library/Std/Config.md",
    "libraries/Library/Std/APIs/Command.md",
  ]
    .map((path) => extractSpaceLuaFromPageText(readFileSync(path, "utf8")))
    .join("\n");
  const config = await loadConfig(
    [
      { ref: "std", code: lua },
      {
        ref: "test",
        code: `slashCommand.define { name = "c", run = function()
          slashCommand.convertLine("> **note** Note\\n> |^|")
        end }`,
      },
    ],
    { editorView: editor },
    false,
  );
  await config.get<Record<string, SlashCommand>>("slashCommands", {}).c.run();
  const doc = editor.state.doc.toString();
  expect(doc).toBe("> **note** Note\n> Remember this\n\nNext");
  expect(editor.state.selection.main.head).toBe(
    "> **note** Note\n> Remember this".length,
  );
});
