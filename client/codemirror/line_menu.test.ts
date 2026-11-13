// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { codeFolding, foldEffect } from "@codemirror/language";
import { EditorSelection, EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { beforeAll, describe, expect, test, vi } from "vitest";
import { loadConfig } from "../boot_config.ts";
import type { PopupEntry } from "../components/popup_menu.ts";
import type { MarkupButton } from "../lib/markup_buttons.ts";
import { buildExtendedMarkdownLanguage } from "../markdown_parser/parser.ts";
import { SlashCommandHook } from "../plugos/hooks/slash_command.ts";
import { extractSpaceLuaFromPageText } from "../space_lua_blocks_test_util.ts";
import {
  fetchTaskStates,
  lineMenuEntries,
  selectionForPick,
} from "./line_menu.ts";

// The default `markupBar.line` list, from Library/Std/Config.md
let DEFAULT_LINE: MarkupButton[] = [];
beforeAll(async () => {
  const lua = [
    "libraries/Library/Std/APIs/Schema.md",
    "libraries/Library/Std/Config.md",
  ]
    .map((path) => extractSpaceLuaFromPageText(readFileSync(path, "utf8")))
    .join("\n");
  const config = await loadConfig([{ ref: "std", code: lua }], {}, false);
  DEFAULT_LINE = config.get<MarkupButton[]>(["markupBar", "line"], []);
});

const invokeFunction = vi.fn((_name: string, _args: unknown[]) =>
  Promise.resolve<unknown>(undefined),
);

const slashRun = vi.fn();
const prose = ["FencedCode", "FrontMatter", "LuaDirective"];
// Slash commands as the Std library defines them (a few of them)
const SLASH_COMMANDS = [
  {
    name: "today",
    displayName: "Today",
    group: "Dates",
    icon: "calendar",
    exceptContexts: prose,
  },
  {
    name: "h1",
    displayName: "Heading 1",
    group: "Basic blocks",
    icon: "md-format-size",
    priority: 94,
    exceptContexts: [...prose, "ListItem"],
  },
  {
    name: "quote",
    displayName: "Quote",
    group: "Basic blocks",
    icon: "md-format-quote",
    priority: 80,
    exceptContexts: [...prose, "ListItem", "Blockquote"],
  },
  {
    name: "text",
    displayName: "Text",
    group: "Basic blocks",
    onlyContexts: ["ATXHeading"],
    exceptContexts: [...prose, "@blank"],
  },
].map((def) => ({ ...def, run: () => slashRun(def.name) }));

function client(
  options: {
    markupBar?: boolean;
    lineHandle?: boolean;
    keyboardBar?: MarkupButton[];
  } = {},
) {
  const values: Record<string, unknown> = {
    "tags.page.renderFrontmatter": () => "form",
    "markupBar.line": DEFAULT_LINE,
  };
  if (options.keyboardBar) values.keyboardBar = options.keyboardBar;
  if (options.lineHandle !== undefined) {
    values["markupBar.lineHandle"] = options.lineHandle;
  }
  const fake = {
    currentName: () => "Notes/Plain",
    currentPageMeta: () => ({}),
    isReadOnlyMode: () => false,
    config: {
      get(path: string | string[], fallback: unknown) {
        const key = Array.isArray(path) ? path.join(".") : path;
        return key in values ? values[key] : fallback;
      },
    },
    clientSystem: {
      scriptsLoaded: true,
      system: { invokeFunction },
      slashCommandHook: undefined as SlashCommandHook | undefined,
    },
    focus: vi.fn(),
    ui: {
      viewState: {
        uiOptions: {
          markdownSyntaxRendering: false,
          markupBar: options.markupBar ?? true,
        },
        commands: new Map([
          [
            "Outline: Move Right",
            { name: "Outline: Move Right", key: "Ctrl-Alt-ArrowRight" },
          ],
        ]),
      },
    },
    systemReady: true,
    fullIndexCompleted: true,
    pageListSource: "index",
    // As Client.extractParentNodes, minus the code bodies
    extractParentNodes(_state: EditorState, node: SyntaxNode) {
      const names: string[] = [];
      for (let n: SyntaxNode | null = node; n; n = n.parent) names.push(n.name);
      return names;
    },
  };
  const hook = new SlashCommandHook(fake as never);
  hook.slashCommands = SLASH_COMMANDS;
  fake.clientSystem.slashCommandHook = hook;
  return fake as never;
}

const at = (doc: string, selection?: EditorSelection | number) =>
  EditorState.create({
    doc,
    selection:
      typeof selection === "number" ? { anchor: selection } : selection,
    extensions: [buildExtendedMarkdownLanguage(), codeFolding()],
  });

const label = (e: PopupEntry) => ("label" in e ? e.label : "");
/** A submenu row's entries */
const subEntries = (e: PopupEntry | undefined) =>
  e?.kind === "submenu" ? e.entries : [];
/** Rows as labels, the current one ticked */
const rows = (entries: PopupEntry[]) =>
  entries.map(
    (e) => `${label(e)}${e.kind === "item" && e.current ? " ✓" : ""}`,
  );
const pick = (e: PopupEntry | undefined) => {
  if (e?.kind !== "item" || !e.run) throw new Error("not a runnable item");
  e.run();
};

const labels = (doc: string, line: number, options = {}) =>
  lineMenuEntries(client(options), at(doc), line).map(label);

describe("line menu", () => {
  test("line 1 of a page without frontmatter starts with Add tag, even with the markup bar off", () => {
    const doc = "# Plain\nBody";
    expect(labels(doc, 1)[0]).toBe("Add tag");
    expect(labels(doc, 1).length).toBeGreaterThan(1);
    expect(labels(doc, 1, { markupBar: false })).toEqual(["Add tag"]);
    // Only on line 1, and not once there is frontmatter
    expect(labels(doc, 2)).not.toContain("Add tag");
    expect(labels("---\na: 1\n---\nBody", 1)).not.toContain("Add tag");
    expect(labels(doc, 2, { markupBar: false })).toEqual([]);
  });

  test("markupBar.lineHandle off empties every menu, Add tag included", () => {
    const doc = "# Plain\n- [ ] t\nBody";
    for (const line of [1, 2, 3]) {
      expect(labels(doc, line, { lineHandle: false })).toEqual([]);
    }
    expect(labels(doc, 1, { lineHandle: true })[0]).toBe("Add tag");
  });

  test("a folded heading or list item offers Expand instead of Collapse", () => {
    const doc = "## A heading\nBody\n- one\n  - nested";
    const state = at(doc).update({
      effects: [
        foldEffect.of({ from: 12, to: 17 }),
        foldEffect.of({ from: 23, to: doc.length }),
      ],
    }).state;
    const entries = (line: number) =>
      lineMenuEntries(client(), state, line).map(label);
    expect(entries(1).slice(1)).toEqual([
      "Heading",
      "Move section up",
      "Move section down",
      "Demote section",
      "Promote section",
      "Expand",
      "",
      "Delete",
    ]);
    expect(entries(3).at(-3)).toBe("Expand");
    expect(labels(doc, 1).at(-3)).toBe("Collapse");
  });

  test("a space's deprecated keyboardBar list leaves the line menu alone", () => {
    const keyboardBar: MarkupButton[] = [{ icon: "grid", description: "Mine" }];
    expect(labels("Text", 1, { keyboardBar })).toEqual(labels("Text", 1));
    expect(labels("Text", 1, { keyboardBar })).not.toContain("Mine");
  });

  test("each kind of line gets its own menu", () => {
    const doc = [
      "---",
      "a: 1",
      "---",
      "A paragraph",
      "",
      "## A heading",
      "- one",
      "  - nested",
      "- [ ] a task",
      "> A quote",
      "",
      "| a | b |",
      "|---|---|",
      "| 1 | 2 |",
    ].join("\n");
    // A paragraph
    expect(labels(doc, 4)).toEqual([
      "Turn into heading",
      "Turn into bullet item",
      "Turn into numbered item",
      "Turn into task",
      "Turn into quote",
      "Upload file",
      "",
      "Delete",
    ]);
    // A blank line: the slash menu's blocks, a submenu per group (of more
    // than one)
    expect(labels(doc, 5)).toEqual(["Basic blocks", "Today"]);
    // Whitespace only counts as blank, between paragraphs too
    expect(labels("One\n   \nTwo", 2)).toEqual(["Basic blocks", "Today"]);
    // A heading
    expect(labels(doc, 6)).toEqual([
      "Heading",
      "Move section up",
      "Move section down",
      "Demote section",
      "Promote section",
      "Collapse",
      "",
      "Delete",
    ]);
    // A list item with nested items, a leaf one, a task
    expect(labels(doc, 7)).toEqual([
      "Indent",
      "Outdent",
      "Move up",
      "Move down",
      "Turn into task",
      "Collapse",
      "",
      "Delete",
    ]);
    expect(labels(doc, 8)).toEqual([
      "Indent",
      "Outdent",
      "Move up",
      "Move down",
      "Turn into task",
      "",
      "Delete",
    ]);
    expect(labels(doc, 9)).toEqual([
      "Set state",
      "Indent",
      "Outdent",
      "Move up",
      "Move down",
      "",
      "Delete",
    ]);
    // A quote: no list or quote conversions
    expect(labels(doc, 10)).toEqual([
      "Turn into heading",
      "Upload file",
      "",
      "Delete",
    ]);
    // A table with its source showing
    expect(labels(doc, 12)).toEqual(["Format table", "", "Delete"]);
    expect(labels(doc, 14)).toEqual([
      "Move row up",
      "Move row down",
      "Format table",
      "",
      "Delete",
    ]);
    // Frontmatter: Delete from its first line only
    expect(labels(doc, 1).at(-1)).toBe("Delete");
    expect(labels(doc, 2)).not.toContain("Delete");
    // Selection buttons never show in the line menu
    expect(labels(doc, 4)).not.toContain("Bold");
  });

  test("Delete removes the line's block of text, with one blank line beside it", () => {
    const run = (doc: string, line: number) => {
      const c = client();
      let state = at(doc);
      (c as any).editorView = {
        get state() {
          return state;
        },
        dispatch: (spec: any) => {
          state = state.update(spec).state;
        },
      };
      const entries = lineMenuEntries(c, state, line);
      pick(entries.find((e) => label(e) === "Delete"));
      return state.doc.toString();
    };
    // A paragraph, from any of its lines
    expect(run("One\n\nTwo\nlines\n\nThree", 4)).toBe("One\n\nThree");
    // A list item with its nested items; its siblings stay
    expect(run("- a\n- b\n  - b1\n- c", 2)).toBe("- a\n- c");
    // A heading line, not its section
    expect(run("# H\nBody", 1)).toBe("Body");
    // A whole quote
    expect(run("Intro\n\n> one\n> two\n\nEnd", 4)).toBe("Intro\n\nEnd");
  });

  test("Delete is left out on blank lines, inside code and when read-only", () => {
    const doc = "```js\nlet a\n```\n\nText";
    expect(labels(doc, 1).at(-1)).toBe("Delete");
    expect(labels(doc, 2)).toEqual([]);
    expect(labels(doc, 4)).not.toContain("Delete");
    const readOnly = client();
    (readOnly as any).isReadOnlyMode = () => true;
    expect(lineMenuEntries(readOnly, at(doc), 5).map(label)).not.toContain(
      "Delete",
    );
  });

  test("a group is one submenu row; the heading's own level is ticked", () => {
    const sub = (doc: string, line: number) =>
      rows(subEntries(lineMenuEntries(client(), at(doc), line)[0]));
    expect(sub("x\n## Title", 2)).toEqual([
      "Heading 1",
      "Heading 2 ✓",
      "Heading 3",
      "Heading 4",
      "Normal text",
    ]);
    expect(sub("x\n#### Title", 2)).toContain("Heading 4 ✓");
    // A paragraph's submenu has no Normal text and nothing ticked
    expect(sub("x\nPara", 2)).toEqual([
      "Heading 1",
      "Heading 2",
      "Heading 3",
      "Heading 4",
    ]);
  });

  test("a blank line's blocks come from the slash menu, in its order; picking one runs it", async () => {
    slashRun.mockClear();
    const onRun = vi.fn((run: () => void) => run());
    const entries = lineMenuEntries(client(), at("A\n\nB"), 2, { onRun });
    expect(rows(subEntries(entries[0]))).toEqual(["Heading 1", "Quote"]);
    // Not on a line with text, nor inside code
    expect(labels("A\n\nB", 1)).not.toContain("Basic blocks");
    expect(labels("```\n\n```", 2)).toEqual([]);
    pick(subEntries(entries[0])[1]);
    expect(onRun).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(slashRun).toHaveBeenCalledWith("quote"));
  });

  test("a task's Set state lists to do, done and the custom states, its own ticked; picking sets it", async () => {
    invokeFunction.mockClear();
    const doc = "x\n- [DOING] a task";
    const state = at(doc);
    const setState = lineMenuEntries(client(), state, 2, {
      taskStates: ["TODO", "DOING"],
    })[0];
    expect(label(setState)).toBe("Set state");
    const states = subEntries(setState);
    expect(rows(states)).toEqual(["Not done", "Done", "TODO", "DOING ✓"]);
    pick(states[1]);
    // At the task box
    expect(invokeFunction).toHaveBeenCalledWith("index.setTaskStateAtPos", [
      doc.indexOf("["),
      "x",
    ]);
    // A failing plug call is reported, not left unhandled
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    invokeFunction.mockRejectedValueOnce(new Error("plug failed"));
    pick(states[0]);
    await vi.waitFor(() => expect(error).toHaveBeenCalled());
    error.mockRestore();
    // A done task (either case) ticks Done; a state the index doesn't know yet
    // is still listed
    const done = lineMenuEntries(client(), at("x\n- [X] t"), 2)[0];
    expect(rows(subEntries(done))).toEqual(["Not done", "Done ✓"]);
    const fresh = lineMenuEntries(client(), at("x\n- [NEW] t"), 2)[0];
    expect(rows(subEntries(fresh))).toEqual(["Not done", "Done", "NEW ✓"]);
    // Part of the markup bar's menus: gone with it
    expect(labels("x\n- [ ] t", 2, { markupBar: false })).toEqual([]);
  });

  test("the custom task states come from the index, none when it fails", async () => {
    invokeFunction.mockResolvedValueOnce(["TODO"]);
    expect(await fetchTaskStates(client())).toEqual(["TODO"]);
    expect(invokeFunction).toHaveBeenLastCalledWith(
      "index.knownTaskStates",
      [],
    );
    invokeFunction.mockRejectedValueOnce(new Error("not loaded"));
    expect(await fetchTaskStates(client())).toEqual([]);
  });

  test("entries carry the command's keyboard hint", () => {
    const hint = (name: string) => {
      const e = lineMenuEntries(client(), at("- one"), 1).find(
        (e) => label(e) === name,
      );
      return e?.kind === "item" ? e.hint : undefined;
    };
    expect(hint("Indent")).toBeTruthy();
    expect(hint("Outdent")).toBeUndefined();
  });

  test("a pick goes through onRun, which decides whether it runs", () => {
    invokeFunction.mockClear();
    const onRun = vi.fn();
    const state = at("x\n- [ ] t");
    const [setState] = lineMenuEntries(client(), state, 2, { onRun });
    pick(subEntries(setState)[1]);
    expect(onRun).toHaveBeenCalledOnce();
    expect(invokeFunction).not.toHaveBeenCalled();
    onRun.mock.calls[0][0]();
    expect(invokeFunction).toHaveBeenCalledWith("index.setTaskStateAtPos", [
      state.doc.toString().indexOf("["),
      "x",
    ]);
  });

  test("no entries on a line inside fenced code", () => {
    const doc = "Text\n```js\nlet a = 1;\n  indented();\n```";
    expect(labels(doc, 3)).toEqual([]);
    expect(labels(doc, 4)).toEqual([]);
  });

  test("a ${…} of its own has the block-actions menu on its first line only; inline keeps the paragraph's", () => {
    const doc = "Intro\n\n${query[[\n  from index.tag 'page'\n]]}\n\nOutro";
    const editing = at(doc, doc.indexOf("from"));
    // Move and Delete act on the editor's state
    const withView = {
      ...(client() as object),
      editorView: { state: editing },
    };
    const entries = (line: number) =>
      lineMenuEntries(withView as never, editing, line).map(label);
    expect(entries(3)).toEqual([
      "Show result",
      "Edit in query builder",
      "",
      "Bake into page",
      "",
      "Move up",
      "Move down",
      "",
      "Delete",
    ]);
    // Its inner lines: no handle at all
    for (const line of [4, 5]) expect(entries(line)).toEqual([]);
    // Inside a paragraph, a ${…} leaves the paragraph's menu
    expect(labels("Some ${1 + 2} text", 1)).toContain("Turn into heading");
  });

  test("picking on a line the selection touches keeps the selection", () => {
    const doc = "one\n- a\n- b\n- c\nfive";
    const state = at(doc, EditorSelection.single(5, 14));
    expect(selectionForPick(state, 3)).toBeUndefined();
    expect(selectionForPick(state, 2)).toBeUndefined();
    expect(selectionForPick(state, 4)).toBeUndefined();
    // A bare cursor on the line counts too
    expect(selectionForPick(at(doc, 9), 3)).toBeUndefined();
  });

  test("picking elsewhere puts the cursor after the list marker", () => {
    const doc = "one\ntwo\nthree\nfour\n- [ ] task\n  - nested\nplain";
    const state = at(doc, 0);
    const line5 = state.doc.line(5);
    expect(selectionForPick(state, 5)?.main.head).toBe(
      line5.from + "- [ ] ".length,
    );
    const line6 = state.doc.line(6);
    expect(selectionForPick(state, 6)?.main.head).toBe(
      line6.from + "  - ".length,
    );
    expect(selectionForPick(state, 7)?.main.head).toBe(state.doc.line(7).from);
    expect(selectionForPick(state, 5)?.main.empty).toBe(true);
  });
});
